"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Layers3, ListChecks, ShieldCheck } from "lucide-react";
import { CommerceWorkflow } from "@/components/commerce-workflow";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/empty-state";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import { currencies, deliveryTimes } from "@/domains/eldorado/contracts";
type Listing = {
  id: string;
  title: string;
  state: string;
  price: number | null;
  currency: string | null;
  quantity: number | null;
};
type Preview = {
  id?: string;
  valid: boolean;
  expiresAt?: string;
  items: {
    target: string;
    title: string;
    before: { price: number; currency: string; quantity: number };
    change: { kind: string; body: unknown };
    floor: number | null;
  }[];
  problems: { offerId: string; title: string; message: string }[];
};
export function OfferBatchCenter({ configured }: { configured: boolean }) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [kind, setKind] = useState("price"),
    [value, setValue] = useState(""),
    [currency, setCurrency] = useState("USD"),
    [delivery, setDelivery] = useState("Minute20"),
    [preview, setPreview] = useState<Preview | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false),
    [message, setMessage] = useState("");
  const requestKey = useRef<string | null>(null);
  const offers = useQuery({
    queryKey: ["batch-offers", cursor],
    queryFn: () =>
      api<{ items: Listing[]; nextCursor: string | null }>(
        `/api/offers?source=predefined${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      ),
    enabled: configured,
    retry: false,
  });
  const permitted = (
    kind === "price"
      ? ["offers.update_price"]
      : kind === "quantity"
        ? ["offers.update_stock"]
        : ["offers.create", "offers.update_price", "offers.update_stock"]
  ).every((p) => me.data?.permissions.includes(p));
  function invalidate() {
    setPreview(null);
    setConfirmed(false);
    setAttempted(false);
    requestKey.current = null;
    setMessage("");
  }
  async function simulate(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setConfirmed(false);
    requestKey.current = null;
    setAttempted(false);
    try {
      setPreview(
        await api<Preview>("/api/offers/batch/preview", {
          method: "POST",
          body: JSON.stringify({
            offerIds: Object.keys(selected),
            change:
              kind === "price"
                ? { kind, amount: Number(value), currency }
                : kind === "quantity"
                  ? { kind, quantity: Number(value) }
                  : { kind, deliveryTime: delivery },
          }),
        }),
      );
    } catch (error) {
      setPreview(null);
      setMessage(
        error instanceof Error ? error.message : "The preview failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function request() {
    if (!preview?.id || busy) return;
    requestKey.current ??= crypto.randomUUID();
    setBusy(true);
    setAttempted(true);
    try {
      const result = await api<{ ids: string[]; message: string }>(
        `/api/offers/batch/${preview.id}/request`,
        {
          method: "POST",
          body: JSON.stringify({
            reason,
            idempotencyKey: requestKey.current,
            confirm: true,
          }),
        },
      );
      setMessage(`${result.ids.length} ${result.message}`);
      setConfirmed(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The batch outcome is unavailable. Recover using this same request key.",
      );
    } finally {
      setBusy(false);
    }
  }
  function requested(item: Preview["items"][number]) {
    if (item.change.kind === "offer.quantity") return String(item.change.body);
    if (item.change.kind === "offer.price") {
      const body = item.change.body as { amount: number; currency: string };
      return unitPrice(body.amount, body.currency);
    }
    const body = item.change.body as {
      details: { guaranteedDeliveryTime: string };
    };
    return body.details.guaranteedDeliveryTime;
  }
  return (
    <div className="commerce-page commerce-batch">
      <PageHeading
        eyebrow="REVIEWED CATALOG WORKBENCH"
        title="More listings. The same control."
        description="Prepare up to 10 predefined listings together, inspect every proposed value and create independent review requests. Previewing sends no marketplace change."
      >
        {me.data?.permissions.includes("offers.create") && (
          <Link href="/offers/import" className="empty-link">
            Import new listings →
          </Link>
        )}
        <Link href="/offers" className="empty-link">
          Back to catalog →
        </Link>
      </PageHeading>
      <CommerceWorkflow
        steps={[
          {
            title: "Select listings",
            description: "Choose the exact products to update",
          },
          {
            title: "Inspect the proposal",
            description: "Validate every amount and price floor",
          },
          {
            title: "Request approval",
            description: "One clear audit trail for each change",
          },
        ]}
      />
      <div className="batch-layout">
        <section className="data-panel settings-section">
          <h2>
            <Layers3 size={18} /> Select exact listings
          </h2>
          <p className="scope-note">
            Only Active or Paused predefined listings are eligible. Source pages
            and aliases are kept explicit.
          </p>
          {offers.isError && <QueryError message={offers.error.message} />}
          <div className="batch-list">
            {offers.data?.items.map((item) => (
              <label className="batch-listing" key={item.id}>
                <input
                  type="checkbox"
                  checked={item.id in selected}
                  disabled={
                    busy ||
                    attempted ||
                    !["Active", "Paused"].includes(item.state) ||
                    (!(item.id in selected) &&
                      Object.keys(selected).length >= 10)
                  }
                  onChange={(event) => {
                    invalidate();
                    setSelected((prior) => {
                      const next = { ...prior };
                      if (event.target.checked) next[item.id] = item.title;
                      else delete next[item.id];
                      return next;
                    });
                  }}
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.state} ·{" "}
                    {item.currency && item.price !== null
                      ? unitPrice(Number(item.price), item.currency)
                      : "Price unavailable"}{" "}
                    · Stock {item.quantity ?? "unknown"}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {offers.isLoading && (
            <p role="status">Loading synchronized listings…</p>
          )}
          {offers.data && !offers.data.items.length && (
            <p className="scope-note">
              No predefined listings on this page. Synchronize the source in
              Offers first.
            </p>
          )}
          <div className="reply-toolbar">
            <Button
              variant="outline"
              disabled={!cursor || busy || attempted}
              onClick={() => setCursor(null)}
            >
              First page
            </Button>
            <Button
              variant="outline"
              disabled={!offers.data?.nextCursor || busy || attempted}
              onClick={() => setCursor(offers.data?.nextCursor ?? null)}
            >
              Next listing page
            </Button>
          </div>
        </section>
        <section className="data-panel settings-section">
          <h2>Prepare a batch</h2>
          <p className="scope-note">
            Selected: {Object.keys(selected).length}/10. Selected titles remain
            listed here when browsing another page.
          </p>
          <ul className="batch-selection">
            {Object.entries(selected).map(([id, title]) => (
              <li key={id}>{title}</li>
            ))}
          </ul>
          <form onSubmit={simulate} className="catalog-editor-form">
            <label className="field-label">
              Batch operation
              <select
                value={kind}
                onChange={(event) => {
                  invalidate();
                  setKind(event.target.value);
                  setValue("");
                }}
                disabled={busy || attempted}
              >
                <option value="price">Set unit price</option>
                <option value="quantity">Set stock quantity</option>
                <option value="delivery">Set guaranteed delivery time</option>
              </select>
            </label>
            {kind === "delivery" ? (
              <label className="field-label">
                Guaranteed delivery time
                <select
                  value={delivery}
                  onChange={(event) => {
                    invalidate();
                    setDelivery(event.target.value);
                  }}
                  disabled={busy || attempted}
                >
                  {deliveryTimes.map((time) => (
                    <option key={time}>{time}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field-label">
                {kind === "price"
                  ? "New unit price for selected listings"
                  : "New stock quantity for selected listings"}
                <input
                  required
                  type="number"
                  min={kind === "price" ? "0.00000001" : "0"}
                  max={kind === "quantity" ? "2147483647" : undefined}
                  step={kind === "quantity" ? "1" : "any"}
                  value={value}
                  onChange={(event) => {
                    invalidate();
                    setValue(event.target.value);
                  }}
                  disabled={busy || attempted}
                />
              </label>
            )}
            {kind === "price" && (
              <label className="field-label">
                Batch currency
                <select
                  value={currency}
                  onChange={(event) => {
                    invalidate();
                    setCurrency(event.target.value);
                  }}
                  disabled={busy || attempted}
                >
                  {currencies.map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </select>
              </label>
            )}
            <Button
              disabled={
                !configured ||
                !permitted ||
                busy ||
                attempted ||
                !Object.keys(selected).length
              }
            >
              <ListChecks size={16} />
              {busy ? "Reading current values…" : "Preview exact changes"}
            </Button>
          </form>
          {!permitted && (
            <p className="scope-note">
              This operation requires its listing permissions. Delivery-time
              replacement requires create, price and stock permissions so no
              field can bypass an override.
            </p>
          )}
          <p className="scope-note">
            This workbench uses individual official endpoints to preserve exact
            targets and per-listing floors. Changing delivery time requires a
            complete product document; incomplete metadata blocks the entire
            preview.
          </p>
        </section>
      </div>
      {preview && (
        <section
          className="data-panel settings-section"
          style={{ marginTop: 24 }}
        >
          <h2>Exact proposal</h2>
          {!preview.valid ? (
            <>
              <p role="alert">
                Some listings could not be verified. No review requests were
                created.
              </p>
              {preview.problems.map((item) => (
                <p className="scope-note" key={item.offerId}>
                  {item.title}: {item.message}
                </p>
              ))}
            </>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Listing</th>
                      <th>Current price</th>
                      <th>Current stock</th>
                      <th>Proposed value</th>
                      <th>Applicable price floor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={item.target}>
                        <td>
                          {item.title}
                          <small className="mono">{item.target}</small>
                        </td>
                        <td>
                          {unitPrice(item.before.price, item.before.currency)}
                        </td>
                        <td>{item.before.quantity}</td>
                        <td>{requested(item)}</td>
                        <td>
                          {item.floor === null
                            ? "No saved floor"
                            : unitPrice(item.floor, item.before.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="scope-note">
                Preview expires at {preview.expiresAt}. Request creation is
                atomic; actual marketplace changes are reviewed and executed
                individually. Each execution checks its current listing again.
              </p>
              <div className="catalog-editor-form">
                <label className="field-label">
                  Reason for this batch
                  <textarea
                    minLength={10}
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={busy || attempted}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={busy || attempted}
                  />
                  I verified every listing and value in this exact proposal.
                </label>
                <Button
                  onClick={request}
                  disabled={busy || !confirmed || reason.trim().length < 10}
                >
                  <ShieldCheck size={16} />
                  {busy
                    ? "Recording requests…"
                    : attempted
                      ? "Recover these requests"
                      : "Request independent review for this batch"}
                </Button>
                <Link href="/approvals">Review requests in Approvals →</Link>
              </div>
            </>
          )}
          {message && (
            <p role="status" className="inline-feedback">
              {message}
            </p>
          )}
        </section>
      )}
      {!preview && message && (
        <p role="status" className="inline-feedback">
          {message}
        </p>
      )}
      {attempted && (
        <Button
          variant="outline"
          onClick={() => {
            invalidate();
            setReason("");
          }}
          disabled={busy}
        >
          Start a new preview
        </Button>
      )}
    </div>
  );
}
