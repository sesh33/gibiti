"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import type { PricingPolicy, PricingQuote } from "@/domains/pricing/models";

export function PricingControls({
  offerId,
  configured,
}: {
  offerId: string;
  configured: boolean;
}) {
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setClock(Date.now()), 0),
      timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const cache = useQueryClient(),
    requestKey = useRef<string | null>(null);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ profile: { id: string; role: string }; permissions: string[] }>(
        "/api/me",
      ),
    enabled: configured,
  });
  const canPrice = !!me.data?.permissions.includes("offers.update_price"),
    owner = me.data?.profile.role === "OWNER";
  const rules = useQuery({
    queryKey: ["pricing-policies", offerId],
    queryFn: () =>
      api<{ items: PricingPolicy[] }>(
        `/api/pricing/policies?offerId=${encodeURIComponent(offerId)}`,
      ),
    enabled: configured && canPrice,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["pricing-history", offerId],
    queryFn: () =>
      api<{ items: PricingQuote[] }>(
        `/api/pricing/history?offerId=${encodeURIComponent(offerId)}`,
      ),
    enabled: configured && canPrice,
    retry: false,
  });
  const policy = rules.data?.items[0];
  const [floor, setFloor] = useState<string | null>(null),
    [difference, setDifference] = useState<string | null>(null),
    [decimals, setDecimals] = useState<number | null>(null),
    [mode, setMode] = useState<PricingPolicy["mode"] | null>(null),
    [interval, setCheckInterval] = useState<number | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState(""),
    [reviewReason, setReviewReason] = useState(""),
    [freshQuote, setFreshQuote] = useState<PricingQuote | null>(null);
  const selectedMode = mode ?? policy?.mode ?? "simulation",
    quote = freshQuote ?? history.data?.items[0];
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await api("/api/pricing/policies", {
        method: "POST",
        body: JSON.stringify({
          offerId,
          floor: Number(floor ?? policy?.floor),
          difference: Number(difference ?? policy?.difference ?? 0.00001),
          decimals: decimals ?? policy?.decimals ?? 5,
          mode: selectedMode,
          intervalSeconds: interval ?? policy?.interval_seconds ?? 15,
          confirmAutomatic: confirmAuto,
        }),
      });
      setFreshQuote(null);
      setConfirmAuto(false);
      setConfirmed(false);
      await cache.invalidateQueries({
        queryKey: ["pricing-policies", offerId],
      });
      setNotice(
        selectedMode === "automatic"
          ? "Rule saved. A different MFA reviewer must approve it, and the workspace automatic-pricing switch must be enabled."
          : "Floor and pricing preferences saved in the database.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The rule could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function simulate() {
    if (!policy || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ quote: PricingQuote; noChange: boolean }>(
        "/api/pricing/quotes",
        { method: "POST", body: JSON.stringify({ policyId: policy.id }) },
      );
      setFreshQuote(result.quote);
      requestKey.current = null;
      setConfirmed(false);
      setNotice(
        result.noChange
          ? "Simulation completed. The computed price already matches your listing."
          : "Simulation completed. No marketplace change was sent.",
      );
      await cache.invalidateQueries({ queryKey: ["pricing-history", offerId] });
    } catch (error) {
      setFreshQuote(null);
      setNotice(
        error instanceof Error
          ? error.message
          : "The market could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function request() {
    if (!quote || busy) return;
    requestKey.current ??= crypto.randomUUID();
    setBusy(true);
    setNotice("");
    try {
      const result = await api<{ message: string }>(
        `/api/pricing/quotes/${quote.id}/request`,
        {
          method: "POST",
          body: JSON.stringify({
            reason,
            idempotencyKey: requestKey.current,
            confirm: true,
          }),
        },
      );
      setNotice(result.message);
      setConfirmed(false);
      await cache.invalidateQueries({ queryKey: ["approvals"] });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The quoted request could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function review(approve: boolean) {
    if (!policy || busy) return;
    setBusy(true);
    try {
      await api(`/api/pricing/policies/${policy.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          version: policy.version,
          approve,
          reason: reviewReason,
        }),
      });
      await cache.invalidateQueries({
        queryKey: ["pricing-policies", offerId],
      });
      setNotice(
        "Policy decision recorded. The workspace switch controls whether approved automatic rules may run.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The rule could not be reviewed.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!canPrice) return null;
  const validQuote =
    quote &&
    policy &&
    quote.policy_version === policy.version &&
    clock !== null &&
    Date.parse(quote.expires_at) > clock;
  return (
    <section
      className="data-panel settings-section full-width"
      aria-label="Pricing controls"
    >
      <div className="settings-heading">
        <span className="settings-icon">
          <ShieldCheck size={21} />
        </span>
        <div>
          <h2>Pricing with a floor</h2>
          <p>
            Simulate first. Manual changes are reviewed; automation requires
            explicit, independently approved authority.
          </p>
        </div>
      </div>
      {rules.isError && <p role="alert">{rules.error.message}</p>}
      {policy && (
        <div className="capability-list">
          <div>
            <span>Saved minimum unit price</span>
            <strong>{unitPrice(Number(policy.floor), policy.currency)}</strong>
          </div>
          <div>
            <span>Saved mode</span>
            <strong>
              {policy.mode} · {policy.review_status}
            </strong>
          </div>
          <div>
            <span>Automatic status</span>
            <span>{policy.last_error_code ?? "No recorded pricing error"}</span>
          </div>
        </div>
      )}
      {owner ? (
        <form onSubmit={save} className="catalog-editor-form">
          <div className="reply-fields">
            <label className="field-label">
              Minimum unit price
              <input
                required
                type="number"
                step="any"
                min="0"
                value={floor ?? String(policy?.floor ?? "")}
                onChange={(event) => setFloor(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field-label">
              Price difference below an equivalent competitor
              <input
                required
                type="number"
                step="any"
                min="0"
                value={difference ?? String(policy?.difference ?? 0.00001)}
                onChange={(event) => setDifference(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field-label">
              Price decimal places
              <input
                type="number"
                min="0"
                max="8"
                value={decimals ?? policy?.decimals ?? 5}
                onChange={(event) => setDecimals(Number(event.target.value))}
                disabled={busy}
              />
            </label>
            <label className="field-label">
              Pricing mode
              <select
                aria-label="Pricing mode"
                value={selectedMode}
                onChange={(event) => {
                  setMode(event.target.value as PricingPolicy["mode"]);
                  setConfirmAuto(false);
                }}
                disabled={busy}
              >
                <option value="simulation">Simulation only</option>
                <option value="manual">Manual with review</option>
                <option value="automatic">Automatic after approval</option>
              </select>
            </label>
            <label className="field-label">
              Automatic check interval (seconds)
              <input
                type="number"
                min="15"
                max="86400"
                value={interval ?? policy?.interval_seconds ?? 15}
                onChange={(event) =>
                  setCheckInterval(Number(event.target.value))
                }
                disabled={busy}
              />
            </label>
          </div>
          {selectedMode === "automatic" && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmAuto}
                onChange={(event) => setConfirmAuto(event.target.checked)}
                disabled={busy}
              />
              I explicitly request automatic repricing for this listing using
              this exact floor, difference and precision.
            </label>
          )}
          <Button
            disabled={busy || (selectedMode === "automatic" && !confirmAuto)}
          >
            Save pricing rule
          </Button>
        </form>
      ) : (
        <p className="scope-note">
          The Owner sets the floor and requested mode. Authorized reviewers can
          review automatic rules.
        </p>
      )}
      {policy?.mode === "automatic" &&
        policy.review_status === "pending" &&
        policy.created_by !== me.data?.profile.id &&
        ["OWNER", "ADMIN", "SUPERVISOR"].includes(
          me.data?.profile.role ?? "",
        ) && (
          <div className="catalog-editor-form">
            <p>
              Review the exact saved floor, difference, precision and interval
              above. <Link href="/mfa">Verify MFA</Link> before deciding.
            </p>
            <p>
              Difference: {policy.difference} {policy.currency}; precision:{" "}
              {policy.decimals}; interval: {policy.interval_seconds}s.
            </p>
            <label className="field-label">
              Pricing review reason
              <input
                minLength={3}
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                disabled={busy}
              />
            </label>
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={busy || reviewReason.trim().length < 3}
                onClick={() => review(false)}
              >
                Reject automatic rule
              </Button>
              <Button
                disabled={busy || reviewReason.trim().length < 3}
                onClick={() => review(true)}
              >
                Approve this automatic rule
              </Button>
            </div>
          </div>
        )}
      <div className="reply-toolbar">
        <Button variant="outline" disabled={busy || !policy} onClick={simulate}>
          {busy ? "Checking…" : "Simulate against the complete market"}
        </Button>
        <Link href="/automation">Workspace automation controls →</Link>
      </div>
      <p className="scope-note">
        A recommendation is blocked if metadata or pagination is incomplete.
        Manual quoted execution checks the market again. No automatic change is
        permitted below the saved floor.
      </p>
      <p className="scope-note">
        USD micro-pricing: $0.00001 equals 0.001 cents and needs at least five
        decimal places. Checks can be configured from 15 seconds; provider
        latency, workload and Retry-After can lengthen that cadence. A saved
        floor always takes priority over undercutting.
      </p>
      {quote && (
        <div>
          <div className="capability-list">
            <div>
              <span>Simulated unit price</span>
              <strong>{unitPrice(Number(quote.amount), quote.currency)}</strong>
            </div>
            <div>
              <span>Verified equivalent offers</span>
              <strong>
                {String(quote.proof.equivalentOffers ?? "Unknown")}
              </strong>
            </div>
            <div>
              <span>Quote status</span>
              <strong>
                {validQuote
                  ? "Fresh"
                  : "Expired or policy changed — simulate again"}
              </strong>
            </div>
          </div>
          {policy?.mode === "manual" && (
            <div className="catalog-editor-form">
              <label className="field-label">
                Reason for this quoted price
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={busy}
                />
                I confirm this listing and the displayed simulated price.
              </label>
              <Button
                disabled={
                  !validQuote || busy || !confirmed || reason.trim().length < 10
                }
                onClick={request}
              >
                Request this quoted price
              </Button>
              <Link href="/approvals">Review pending requests →</Link>
            </div>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="inline-feedback">
          {notice}
        </p>
      )}
      {history.data?.items.length ? (
        <details>
          <summary>
            Saved simulation history ({history.data.items.length})
          </summary>
          {history.data.items.map((item) => (
            <p className="scope-note" key={item.id}>
              {new Date(item.created_at).toLocaleString()} ·{" "}
              {unitPrice(Number(item.amount), item.currency)} · rule{" "}
              {item.policy_version.slice(0, 8)}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}
