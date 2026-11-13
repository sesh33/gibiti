"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Power, RefreshCw, ShieldCheck } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { QueryError } from "@/components/empty-state";
import { api } from "@/lib/api-client";
import type { SellerAction } from "@/domains/eldorado/seller-contracts";
type Notification = {
  id: string | null;
  title: string | null;
  message: string | null;
  type: string | null;
  createdAt: string | null;
  isRead: boolean | null;
};
type ActionRow = {
  id: string;
  kind: string;
  status: string;
  reason: string;
  error_code: string | null;
  created_at: string;
};
type Check = { name: string; ok: boolean; value?: unknown; code?: string };
function metric(check: Check | undefined) {
  if (!check) return "—";
  if (!check.ok) return "Unavailable";
  if (typeof check.value === "boolean")
    return check.value ? "Eligible" : "Not eligible";
  if (typeof check.value === "number") return String(check.value);
  if (Array.isArray(check.value)) return String(check.value.length);
  if (check.value && typeof check.value === "object" && "unread" in check.value)
    return (
      String(check.value.unread) +
      ("hasMore" in check.value && check.value.hasMore ? "+" : "")
    );
  return "Unavailable";
}
export function SellerCenter({ configured }: { configured: boolean }) {
  const cache = useQueryClient(),
    key = useRef<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<SellerAction | null>(null),
    [manual, setManual] = useState<ActionRow | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [typed, setTyped] = useState(""),
    [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false),
    [message, setMessage] = useState("");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ profile: { role: string }; permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const can = (permission: string) =>
      !!me.data?.permissions.includes(permission),
    owner = me.data?.profile.role === "OWNER";
  const overview = useQuery({
    queryKey: ["seller-overview"],
    queryFn: () => api<{ checks: Check[]; checkedAt: string }>("/api/seller"),
    enabled: configured && can("seller.read"),
    retry: false,
  });
  const notifications = useQuery({
    queryKey: ["seller-notifications", cursor],
    queryFn: () =>
      api<{
        items: Notification[];
        nextCursor: string | null;
        checkedAt: string;
      }>(
        `/api/seller/notifications${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
      ),
    enabled: configured && can("notifications.read"),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["seller-actions"],
    queryFn: () => api<{ items: ActionRow[] }>("/api/seller/actions"),
    enabled: configured,
    retry: false,
  });
  function open(action: SellerAction) {
    setSelected(action);
    setManual(null);
    setReason("");
    setTyped("");
    setConfirmed(false);
    setAttempted(false);
    key.current = null;
  }
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["seller-overview"] }),
      cache.invalidateQueries({ queryKey: ["seller-notifications"] }),
      cache.invalidateQueries({ queryKey: ["seller-actions"] }),
    ]);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (manual) {
        await api(`/api/seller/actions/${manual.id}/manual-check`, {
          method: "POST",
          body: JSON.stringify({ reason, confirmedCheckedOnEldorado: true }),
        });
        setMessage(
          "Manual verification recorded. No Seller write was sent again.",
        );
      } else if (selected) {
        key.current ??= crypto.randomUUID();
        setAttempted(true);
        const result = await api<{ message: string }>("/api/seller/actions", {
          method: "POST",
          body: JSON.stringify({
            action: selected,
            reason,
            idempotencyKey: key.current,
            confirm: true,
          }),
        });
        setMessage(result.message);
      }
      setSelected(null);
      setManual(null);
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The action could not be completed. Recover the existing request before creating another.",
      );
    } finally {
      setBusy(false);
    }
  }
  const actionName =
    selected?.kind === "seller.offline"
      ? "Set seller offline"
      : selected?.kind === "seller.online"
        ? "Set seller online"
        : selected?.kind === "notification.read"
          ? "Mark notification read"
          : "Mark all notifications read";
  const global = selected?.kind.startsWith("seller."),
    confirmationWord =
      selected?.kind === "seller.offline" ? "OFFLINE" : "ONLINE";
  return (
    <>
      <PageHeading
        eyebrow="CONNECTED SELLER OPERATIONS"
        title="A command center for your seller account."
        description="Official notifications, account restrictions and eligibility, with deliberate account controls and a permanent action history."
      >
        <Button
          variant="outline"
          onClick={refresh}
          disabled={
            !configured || overview.isFetching || notifications.isFetching
          }
        >
          <RefreshCw size={15} />
          Refresh official data
        </Button>
      </PageHeading>
      <div className="metric-grid">
        {[
          ["eligibility", "Seller API access"],
          ["restrictions", "Restriction entries"],
          ["unread", "Unread notifications"],
          ["pendingReviews", "Orders awaiting review"],
        ].map(([name, label]) => (
          <article className="metric-card" key={name}>
            <div>
              <span>{label}</span>
              <ShieldCheck size={16} />
            </div>
            <strong>
              {metric(overview.data?.checks.find((item) => item.name === name))}
            </strong>
            <small>
              {overview.data
                ? "Reported by Eldorado"
                : "Awaiting an authorized read"}
            </small>
          </article>
        ))}
      </div>
      {overview.isError && <QueryError message={overview.error.message} />}
      {overview.data?.checks
        .filter((item) => !item.ok)
        .map((item) => (
          <p className="scope-note" key={item.name}>
            {item.name}: {item.code}. Other successful checks remain available.
          </p>
        ))}
      <div className="settings-grid">
        <section className="data-panel settings-section">
          <h2>Seller availability</h2>
          <p className="scope-note">
            Online/offline affects this seller account across listings. Only the
            Owner can request it here, with MFA. The API exposes the switch
            commands; it does not provide an independent current-status read in
            these contracts.
          </p>
          <div className="reply-toolbar">
            <Button
              variant="outline"
              disabled={!owner || !can("seller.manage")}
              onClick={() => open({ kind: "seller.online" })}
            >
              <Power size={15} />
              Set online
            </Button>
            <Button
              variant="outline"
              disabled={!owner || !can("seller.manage")}
              onClick={() => open({ kind: "seller.offline" })}
            >
              <Power size={15} />
              Set offline
            </Button>
          </div>
          <a href="https://www.eldorado.gg" target="_blank" rel="noreferrer">
            Check your seller account on Eldorado ↗
          </a>
        </section>
        <section className="data-panel settings-section">
          <h2>Account restrictions</h2>
          {overview.data?.checks.find((item) => item.name === "restrictions")
            ?.ok ? (
            Array.isArray(
              overview.data.checks.find((item) => item.name === "restrictions")
                ?.value,
            ) &&
            (
              overview.data.checks.find((item) => item.name === "restrictions")!
                .value as {
                reason: string | null;
                type?: string | null;
                until?: string | null;
              }[]
            ).length ? (
              (
                overview.data.checks.find(
                  (item) => item.name === "restrictions",
                )!.value as {
                  reason: string | null;
                  type?: string | null;
                  until?: string | null;
                }[]
              ).map((item, index) => (
                <p className="scope-note" key={index}>
                  {item.type ?? "Restriction"}:{" "}
                  {item.reason ??
                    "Details are unavailable in this API response. Check Eldorado."}
                  {item.until ? ` · Until ${item.until}` : ""}
                </p>
              ))
            ) : (
              <p className="scope-note">
                No restriction entries were returned by the last official read.
              </p>
            )
          ) : (
            <p className="scope-note">
              Restrictions have not been verified. This is not evidence that the
              account is unrestricted.
            </p>
          )}
        </section>
      </div>
      <section
        className="data-panel settings-section"
        style={{ marginTop: 24 }}
      >
        <div className="panel-title">
          <h2>
            <Bell size={18} /> Official notifications
          </h2>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !can("notifications.manage") || !notifications.data?.items.length
            }
            onClick={() => open({ kind: "notifications.read_all" })}
          >
            <CheckCheck size={14} />
            Mark all read
          </Button>
        </div>
        {notifications.isError && (
          <QueryError message={notifications.error.message} />
        )}
        {notifications.isLoading && <p role="status">Loading notifications…</p>}
        {notifications.data?.items.map((item, index) => (
          <article className="seller-notification" key={item.id ?? index}>
            <div>
              <strong>
                {item.title ?? item.type ?? "Eldorado notification"}
              </strong>
              <span className="pill pill-muted">
                {item.isRead === null
                  ? "Read status unavailable"
                  : item.isRead
                    ? "Read"
                    : "Unread"}
              </span>
            </div>
            {item.message && <p>{item.message}</p>}
            <small>{item.createdAt ?? "Date not provided"}</small>
            {item.id && (
              <Button
                variant="outline"
                size="sm"
                disabled={!can("notifications.manage") || item.isRead === true}
                onClick={() =>
                  open({ kind: "notification.read", notificationId: item.id! })
                }
              >
                Mark read
              </Button>
            )}
          </article>
        ))}
        {notifications.data && !notifications.data.items.length && (
          <p className="scope-note">
            No notifications were returned on this page.
          </p>
        )}
        {!configured && (
          <p className="scope-note">
            Connect your workspace to read actual seller notifications.
          </p>
        )}
        <div className="reply-toolbar">
          {cursor && (
            <Button variant="outline" onClick={() => setCursor(null)}>
              Latest page
            </Button>
          )}
          <Button
            variant="outline"
            disabled={
              !notifications.data?.nextCursor || notifications.isFetching
            }
            onClick={() => setCursor(notifications.data?.nextCursor ?? null)}
          >
            Next notification page
          </Button>
        </div>
      </section>
      <section
        className="data-panel settings-section"
        style={{ marginTop: 24 }}
      >
        <h2>Seller action history</h2>
        {history.isError && <QueryError message={history.error.message} />}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Result</th>
                <th>Created</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.kind}
                    <small>{item.reason}</small>
                  </td>
                  <td>
                    {item.status}
                    <small>{item.error_code}</small>
                  </td>
                  <td>{new Date(item.created_at).toLocaleString()}</td>
                  <td>
                    {owner && ["running", "unknown"].includes(item.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setManual(item);
                          setSelected(null);
                          setReason("");
                          setConfirmed(false);
                          setAttempted(false);
                        }}
                      >
                        Record manual check
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {history.data && !history.data.items.length && (
          <p className="scope-note">No Seller actions recorded.</p>
        )}
        <p className="scope-note">
          Acknowledged means HTTP acceptance, not independent verification of
          seller availability. Uncertain requests are never retried
          automatically. The Owner can record a manual verification after
          checking Eldorado and waiting at least one minute.
        </p>
      </section>
      {message && (
        <p role="status" className="inline-feedback">
          {message}
        </p>
      )}
      <Dialog
        open={!!selected || !!manual}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setSelected(null);
            setManual(null);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>
            {manual ? "Record an independent manual check" : actionName}
          </DialogTitle>
          <DialogDescription>
            {manual
              ? "First check the actual outcome directly on Eldorado. This records your verification and releases the unresolved action; it never repeats its request."
              : global
                ? "This affects the entire seller account. Confirm the intended availability and check Eldorado after HTTP acceptance."
                : "This changes read state on Eldorado. It does not delete notifications or send any message."}
          </DialogDescription>
          <form className="catalog-editor-form" onSubmit={submit}>
            {selected && (
              <p className="scope-note">
                Exact action: {selected.kind}
                {"notificationId" in selected
                  ? ` · ${selected.notificationId}`
                  : ""}
              </p>
            )}
            <label className="field-label">
              Reason for this Seller action
              <textarea
                required
                minLength={manual ? 20 : 10}
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy || attempted}
              />
            </label>
            {global && (
              <label className="field-label">
                Type {confirmationWord} to confirm
                <input
                  required
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  disabled={busy || attempted}
                />
              </label>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={busy || attempted}
              />
              {manual
                ? "I checked the actual result directly on Eldorado."
                : "I confirm this exact Seller action and its account scope."}
            </label>
            <Button
              disabled={
                busy ||
                !confirmed ||
                reason.trim().length < (manual ? 20 : 10) ||
                (global && typed !== confirmationWord)
              }
            >
              {busy
                ? "Recording…"
                : manual
                  ? "Save manual verification"
                  : attempted
                    ? "Recover this request without resending"
                    : "Confirm Seller action"}
            </Button>
          </form>
          {message && <p role="status">{message}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
