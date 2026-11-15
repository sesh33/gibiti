"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import type { PricingPolicy } from "@/domains/pricing/models";
import { RepricingMonitor } from "@/components/repricing-monitor";
import type {
  AutomationRuntimeHealth,
  SchedulerHealth,
} from "@/domains/eldorado/integration-health";
import { cooldownTime } from "@/domains/eldorado/integration-health";
type Settings = {
  pollEnabled: boolean;
  pollSeconds: number;
  autoDeliveryEnabled: boolean;
  autoPricingEnabled: boolean;
};
type State = {
  connection?: {
    configured: boolean;
    verifiedAt: string | null;
    verifiedOrigin: string | null;
    verifiedOnThisServer?: boolean;
  };
  settings: Settings;
  runtime: AutomationRuntimeHealth | null;
  runtimeAccess?: "authorized" | "restricted" | "unavailable";
  scheduler?: SchedulerHealth;
  checkedAt?: string;
};
export function AutomationSettings({ configured }: { configured: boolean }) {
  const cache = useQueryClient(),
    [edits, setEdits] = useState<Partial<Settings>>({}),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ profile: { role: string }; permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const state = useQuery({
    queryKey: ["automation-settings"],
    queryFn: () => api<State>("/api/automation/settings"),
    enabled: configured,
    retry: false,
    refetchInterval: 15000,
  });
  const policies = useQuery({
    queryKey: ["pricing-policies", "all"],
    queryFn: () => api<{ items: PricingPolicy[] }>("/api/pricing/policies"),
    enabled:
      configured && !!me.data?.permissions.includes("offers.update_price"),
    retry: false,
    refetchInterval: 15000,
  });
  const owner = me.data?.profile.role === "OWNER",
    runtime = state.isError ? null : state.data?.runtime,
    scheduler = state.isError ? null : state.data?.scheduler,
    settings = {
      ...(state.data?.settings ?? {
        pollEnabled: false,
        pollSeconds: 60,
        autoDeliveryEnabled: false,
        autoPricingEnabled: false,
      }),
      ...edits,
    };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await api("/api/automation/settings", {
        method: "POST",
        body: JSON.stringify({ ...settings, confirmAutomation: confirmed }),
      });
      setEdits({});
      setConfirmed(false);
      await cache.invalidateQueries({ queryKey: ["automation-settings"] });
      setNotice(
        "Workspace preferences saved. Stop switches prevent new automatic claims; an already-issued request may still finish.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Preferences could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="automation-workspace">
      <PageHeading
        eyebrow="PERSISTENT OPERATION CONTROLS"
        title="Automation, on your terms."
        description="Durable floors, preferences and processing history. Simulation first; automatic writes only after explicit authorization."
      />
      <div className="automation-principles" aria-label="Automation safeguards">
        <span>
          <SlidersHorizontal size={14} /> Offer-specific floors
        </span>
        <span>
          <ShieldCheck size={14} /> Independent review
        </span>
        <span>
          <Activity size={14} /> Recorded outcomes
        </span>
      </div>
      <RepricingMonitor configured={configured} />
      <div className="settings-grid">
        <section className="data-panel settings-section">
          <div className="automation-section-heading">
            <span>
              <Activity size={20} />
            </span>
            <div>
              <small>RUNTIME OBSERVABILITY</small>
              <h2>Workspace background service</h2>
            </div>
          </div>
          <p className="scope-note">
            Seller read verification:{" "}
            {!state.isError && state.data?.connection?.verifiedOnThisServer
              ? "verified on this server"
              : "Owner verification required in Settings"}
            .
          </p>
          <div className="capability-list">
            <div>
              <span>Hosted scheduler</span>
              <strong>
                {state.isError
                  ? "Status unavailable"
                  : (scheduler?.label ??
                    (state.isFetching ? "Checking" : "Not checked"))}
              </strong>
            </div>
            <div>
              <span>Last worker heartbeat</span>
              <span>
                {runtime?.last_heartbeat_at
                  ? new Date(runtime.last_heartbeat_at).toLocaleString()
                  : state.isError || state.data?.runtimeAccess === "unavailable"
                    ? "Status unavailable"
                    : state.data?.runtimeAccess === "restricted"
                      ? "Details restricted"
                      : "No heartbeat recorded"}
              </span>
            </div>
            <div>
              <span>Last background order read</span>
              <span>
                {runtime?.last_poll_at
                  ? new Date(runtime.last_poll_at).toLocaleString()
                  : state.isError || state.data?.runtimeAccess === "unavailable"
                    ? "Status unavailable"
                    : state.data?.runtimeAccess === "restricted"
                      ? "Details restricted"
                      : "No background read recorded"}
              </span>
            </div>
            <div>
              <span>Last scheduler dispatch</span>
              <span>
                {runtime?.last_dispatch_at
                  ? `${new Date(runtime.last_dispatch_at).toLocaleString()} · ${runtime.last_dispatch_status === null ? "transport result unavailable" : `HTTP ${runtime.last_dispatch_status}`}`
                  : state.isError || state.data?.runtimeAccess === "unavailable"
                    ? "Status unavailable"
                    : state.data?.runtimeAccess === "restricted"
                      ? "Details restricted"
                      : "No dispatch recorded"}
              </span>
            </div>
            <div>
              <span>Order catchup</span>
              <span>
                {runtime
                  ? `${runtime.pending_backfill_pages} saved cursor ${runtime.pending_backfill_pages === 1 ? "task" : "tasks"}`
                  : state.data?.runtimeAccess === "restricted"
                    ? "Details restricted"
                    : "Status unavailable"}
              </span>
            </div>
          </div>
          {scheduler && <p className="scope-note">{scheduler.action}</p>}
          {runtime?.last_error_code && (
            <p className="scope-note">
              Recorded code: <code>{runtime.last_error_code}</code>.
            </p>
          )}
          {runtime?.provider_backoff_until && (
            <p className="scope-note">
              Provider request cooldown recorded until{" "}
              {cooldownTime(runtime.provider_backoff_until)}. All Seller
              requests share this cooldown.
            </p>
          )}
          {runtime?.backoff_until && (
            <p className="scope-note">
              Read backoff until{" "}
              {new Date(runtime.backoff_until).toLocaleString()}. The runner
              respects provider Retry-After and does not replay uncertain
              writes.
            </p>
          )}
          <p className="scope-note">
            Background work runs while your browser is closed. No new work is
            dispatched when nothing is due; an older heartbeat can be normal.
            {state.data?.checkedAt &&
              !state.isError &&
              ` Local runtime checked ${new Date(state.data.checkedAt).toLocaleString()}.`}
          </p>
          {state.isError && <p role="alert">{state.error.message}</p>}
        </section>
        <section className="data-panel settings-section">
          <div className="automation-section-heading">
            <span>
              <LockKeyhole size={20} />
            </span>
            <div>
              <small>EXPLICIT AUTHORITY</small>
              <h2>Owner authorization</h2>
            </div>
          </div>
          {owner ? (
            <form onSubmit={save} className="catalog-editor-form">
              <label className="checkbox-label automation-choice">
                <input
                  type="checkbox"
                  checked={settings.pollEnabled}
                  onChange={(event) =>
                    setEdits((previous) => ({
                      ...previous,
                      pollEnabled: event.target.checked,
                    }))
                  }
                  disabled={busy}
                />
                Poll sold orders in the background
              </label>
              <label className="field-label">
                Background read interval (seconds)
                <input
                  type="number"
                  min="60"
                  max="86400"
                  value={settings.pollSeconds}
                  onChange={(event) =>
                    setEdits((previous) => ({
                      ...previous,
                      pollSeconds: Number(event.target.value),
                    }))
                  }
                  disabled={busy}
                />
              </label>
              <label className="checkbox-label automation-choice">
                <input
                  type="checkbox"
                  checked={settings.autoPricingEnabled}
                  onChange={(event) => {
                    setEdits((previous) => ({
                      ...previous,
                      autoPricingEnabled: event.target.checked,
                    }));
                    setConfirmed(false);
                  }}
                  disabled={busy}
                />
                Allow independently approved automatic pricing rules
              </label>
              <label className="checkbox-label automation-choice">
                <input
                  type="checkbox"
                  checked={settings.autoDeliveryEnabled}
                  onChange={(event) => {
                    setEdits((previous) => ({
                      ...previous,
                      autoDeliveryEnabled: event.target.checked,
                    }));
                    setConfirmed(false);
                  }}
                  disabled={busy}
                />
                Allow automatic delivery marking for fulfilled, independently
                approved requests
              </label>
              {(settings.autoPricingEnabled ||
                settings.autoDeliveryEnabled) && (
                <label className="checkbox-label automation-choice">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={busy}
                  />
                  I explicitly authorize the selected automatic modes. Pricing
                  obeys each reviewed floor. Delivery marking requires recorded
                  transfer confirmation and approval.
                </label>
              )}
              <Button
                disabled={
                  busy ||
                  ((settings.autoPricingEnabled ||
                    settings.autoDeliveryEnabled) &&
                    !confirmed)
                }
              >
                Save workspace authorization
              </Button>
              <p className="scope-note">
                All automatic modes start disabled. Uncheck both automatic
                switches and save to stop new automatic writes. This does not
                undo an in-flight request.
              </p>
            </form>
          ) : (
            <p className="scope-note">
              The Owner controls workspace automation. Authorized staff can
              review eligible rules and requests using their own accounts.
            </p>
          )}
          <Link href="/settings">Connection and authenticator settings →</Link>
        </section>
      </div>
      {notice && (
        <p role="status" className="inline-feedback">
          {notice}
        </p>
      )}
      <section className="data-panel settings-section automation-rules-panel">
        <div className="automation-section-heading">
          <span>
            <SlidersHorizontal size={20} />
          </span>
          <div>
            <small>YOUR RULEBOOK</small>
            <h2>Saved pricing rules</h2>
          </div>
        </div>
        <p className="scope-note">
          Configure floors and simulate from a predefined offer&apos;s Edit /
          compare page. Automatic rules need a different MFA reviewer before the
          workspace switch can run them.
        </p>
        {policies.isError && <p role="alert">{policies.error.message}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Listing</th>
                <th>Floor</th>
                <th>Difference</th>
                <th>Mode / review</th>
                <th>Next check</th>
                <th>Last check / diagnostic</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {policies.data?.items.map((policy) => (
                <tr key={policy.id}>
                  <td className="mono">{policy.native_id.slice(0, 12)}</td>
                  <td>{unitPrice(Number(policy.floor), policy.currency)}</td>
                  <td>{policy.difference}</td>
                  <td>
                    {policy.mode} / {policy.review_status}
                  </td>
                  <td>{new Date(policy.next_run_at).toLocaleString()}</td>
                  <td>
                    {policy.last_checked_at
                      ? new Date(policy.last_checked_at).toLocaleString()
                      : "No check recorded"}
                    <small>
                      {policy.last_error_code ?? "No recorded pricing error"}
                    </small>
                  </td>
                  <td>
                    <Link
                      className="button button-outline button-sm"
                      href={`/offers/edit?id=${encodeURIComponent(policy.offer_id)}`}
                    >
                      Open rule
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!policies.data?.items.length && (
          <p className="scope-note">
            No saved rules are displayed. Nothing is automatically repriced.
          </p>
        )}
      </section>
    </div>
  );
}
