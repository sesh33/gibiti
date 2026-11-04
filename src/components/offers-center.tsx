"use client";
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-heading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, QueryError } from "@/components/empty-state";
import { api } from "@/lib/api-client";
import { money } from "@/lib/utils";
import {
  offerSources,
  sourceLabels,
  type OfferSource,
} from "@/domains/offers/definitions";
import type { OfferRecord } from "@/domains/offers/schemas";
type ReadPage = {
  items: OfferRecord[];
  nextCursor: string | null;
  sync: { provider: string; last_success_at: string | null; scope: string }[];
  scope: string;
};
type SyncResult =
  | {
      ok: true;
      source: OfferSource;
      count: number;
      index: number;
      size: number;
      recordCount: number;
      totalPages: number;
      hasMore: boolean;
    }
  | {
      ok: false;
      source: OfferSource;
      error: { code: string; message: string };
    };
type AvailabilityAction = "pause" | "resume";
type AvailabilityOperation = {
  id: string;
  offer_id: string;
  native_id: string;
  action: AvailabilityAction;
  status: "running" | "succeeded" | "failed" | "unknown" | "rejected";
  observed_state: string | null;
  error_code: string | null;
  created_at: string;
};
type AvailabilityRequest = {
  offerId: string;
  action: AvailabilityAction;
  expectedSnapshot: string;
  reason: string;
  idempotencyKey: string;
  confirm: true;
};
type AvailabilityAttempt = {
  nativeId?: string;
  request?: AvailabilityRequest;
  operation?: AvailabilityOperation;
  busy: boolean;
  message: string;
  missing?: boolean;
};
function actionForState(state: string): AvailabilityAction | null {
  return state === "Active" ? "pause" : state === "Paused" ? "resume" : null;
}
function outcomeLabel(operation: AvailabilityOperation) {
  switch (operation.status) {
    case "succeeded":
      return "Verified in Eldorado";
    case "unknown":
      return "Outcome not confirmed";
    case "running":
      return "Change in progress";
    case "rejected":
      return "Change not applied";
    default:
      return "Request failed";
  }
}
function unresolved(attempt: AvailabilityAttempt | undefined) {
  return Boolean(
    attempt &&
    !attempt.missing &&
    (!attempt.operation ||
      attempt.operation.status === "unknown" ||
      attempt.operation.status === "running"),
  );
}
export function OffersCenter({ configured }: { configured: boolean }) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname(),
    cache = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? ""),
    [results, setResults] = useState<SyncResult[]>([]),
    [feedback, setFeedback] = useState(""),
    [selected, setSelected] = useState<OfferRecord | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [attempts, setAttempts] = useState<Record<string, AvailabilityAttempt>>({});
  const writesInFlight = useRef(new Set<string>());
  const source = params.get("source") ?? "all",
    state = params.get("state") ?? "";
  const query = useQuery({
    queryKey: ["offers", params.toString()],
    queryFn: () => api<ReadPage>(`/api/offers?${params}`),
    enabled: configured,
    refetchInterval: 60000,
  });
  const access = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const canManage = Boolean(
    access.data?.permissions.includes("offers.read") &&
    access.data.permissions.includes("offers.pause"),
  );
  const history = useQuery({
    queryKey: ["offer-availability"],
    queryFn: () =>
      api<{ items: AvailabilityOperation[] }>("/api/offers/availability"),
    enabled: configured && canManage,
    refetchInterval: 30000,
  });
  const canChange = canManage && history.isSuccess;
  const synchronize = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/offers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = await response.json();
      if (Array.isArray(data.results)) {
        setResults(data.results);
        return data as { results: SyncResult[] };
      }
      throw new Error(
        data.error?.message ?? "The listings could not be synchronized.",
      );
    },
    onSuccess: (data) => {
      const successes = data.results.filter((result) => result.ok).length;
      setFeedback(
        `${successes} of ${data.results.length} listing categories synchronized. No listings were changed in Eldorado.`,
      );
      cache.invalidateQueries({ queryKey: ["offers"] });
    },
    onError: (error) => setFeedback(error.message),
  });
  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "cursor") next.delete("cursor");
    router.push(`${pathname}?${next}`);
  }
  function latestAttempt(offerId: string) {
    const nativeId = query.data?.items.find(
      (offer) => offer.id === offerId,
    )?.native_id;
    const exact = attempts[offerId];
    const local = unresolved(exact)
      ? exact
      : (Object.values(attempts).find(
          (attempt) =>
            nativeId && attempt.nativeId === nativeId && unresolved(attempt),
        ) ?? exact);
    if (unresolved(local)) return local;
    const pending = history.data?.items.find(
      (operation) =>
        (operation.offer_id === offerId ||
          (nativeId && operation.native_id === nativeId)) &&
        ["running", "unknown"].includes(operation.status),
    );
    if (
      pending &&
      (!local?.operation ||
        new Date(pending.created_at) > new Date(local.operation.created_at))
    )
      return {
        nativeId: pending.native_id,
        operation: pending,
        busy: false,
        message: "",
      };
    return local;
  }
  function remember(offerId: string, attempt: AvailabilityAttempt) {
    setAttempts((previous) => {
      const next = { ...previous, [offerId]: attempt };
      for (const [key, value] of Object.entries(previous))
        if (attempt.nativeId && value.nativeId === attempt.nativeId)
          next[key] = attempt;
      return next;
    });
  }
  function openAction(offer: OfferRecord) {
    setSelected(offer);
    setReason("");
    setConfirmed(false);
    if (!unresolved(latestAttempt(offer.id)))
      setAttempts((previous) => {
        const next = { ...previous };
        delete next[offer.id];
        return next;
      });
  }
  async function executeAvailability() {
    if (
      !selected ||
      !canChange ||
      !confirmed ||
      reason.trim().length < 10 ||
      writesInFlight.current.has(selected.native_id)
    )
      return;
    const action = actionForState(selected.state);
    if (!action || unresolved(latestAttempt(selected.id))) return;
    const offerId = selected.id,
      nativeId = selected.native_id;
    writesInFlight.current.add(nativeId);
    const request: AvailabilityRequest = {
      offerId,
      action,
      expectedSnapshot: selected.updated_at,
      reason: reason.trim(),
      idempotencyKey: crypto.randomUUID(),
      confirm: true,
    };
    const attempt: AvailabilityAttempt = {
      nativeId: selected.native_id,
      request,
      busy: true,
      message: "Checking the current listing before applying your change…",
    };
    remember(offerId, attempt);
    try {
      const response = await fetch("/api/offers/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const result = (await response.json()) as {
        operation?: AvailabilityOperation;
        message?: string;
        error?: { message?: string };
      };
      if (!result.operation)
        throw new Error(
          result.error?.message ??
            "The operation result could not be verified.",
        );
      remember(offerId, {
        ...attempt,
        operation: result.operation,
        busy: false,
        message: result.message ?? "",
      });
      cache.invalidateQueries({ queryKey: ["offer-availability"] });
      cache.invalidateQueries({ queryKey: ["offers"] });
    } catch (error) {
      remember(offerId, {
        ...attempt,
        busy: false,
        message:
          (error instanceof Error ? error.message + " " : "") +
          "Check the operation outcome before starting another change. This request will not be sent again automatically.",
      });
    } finally {
      writesInFlight.current.delete(nativeId);
    }
  }
  async function checkAvailability(offerId: string) {
    const attempt = latestAttempt(offerId);
    if (!attempt || attempt.busy) return;
    remember(offerId, {
      ...attempt,
      busy: true,
      message: "Checking Eldorado…",
    });
    try {
      let operation = attempt.operation;
      if (!operation && attempt.request) {
        const result = await api<{ operation: AvailabilityOperation | null }>(
          `/api/offers/availability?idempotencyKey=${encodeURIComponent(attempt.request.idempotencyKey)}`,
        );
        operation = result.operation ?? undefined;
      }
      if (!operation) {
        remember(offerId, {
          ...attempt,
          busy: false,
          missing: true,
          message:
            "No accepted operation was found. Refresh the listing and open a new confirmation if you still want to change it.",
        });
        cache.invalidateQueries({ queryKey: ["offers"] });
        return;
      }
      let message = "The saved operation result has been recovered.";
      if (["running", "unknown"].includes(operation.status)) {
        const result = await api<{
          operation: AvailabilityOperation;
          message: string;
        }>(`/api/offers/availability/${operation.id}/reconcile`, {
          method: "POST",
          body: "{}",
        });
        operation = result.operation;
        message = result.message;
      }
      remember(offerId, { ...attempt, operation, busy: false, message });
      cache.invalidateQueries({ queryKey: ["offer-availability"] });
      cache.invalidateQueries({ queryKey: ["offers"] });
    } catch (error) {
      remember(offerId, {
        ...attempt,
        busy: false,
        message:
          error instanceof Error
            ? error.message
            : "The outcome could not be checked. No change was sent again.",
      });
    }
  }
  const rows = query.data?.items ?? [];
  const states = [...new Set(rows.map((row) => row.state))].sort();
  const selectedAttempt = selected ? latestAttempt(selected.id) : undefined,
    selectedAction = selected ? actionForState(selected.state) : null,
    pendingOperations = history.data?.items.filter((operation) =>
      ["running", "unknown"].includes(operation.status),
    );
  return (
    <>
      <PageHeading
        eyebrow="LISTING OPERATIONS"
        title="Offers, without the clutter."
        description="Your real listings, with controlled availability changes and a record of every action."
      >
        <Button
          variant="outline"
          disabled={!configured || synchronize.isPending}
          onClick={() => {
            setFeedback("");
            synchronize.mutate();
          }}
        >
          <RefreshCw
            size={14}
            className={synchronize.isPending ? "spin" : ""}
          />
          {synchronize.isPending
            ? "Reading listings..."
            : source === "all"
              ? "Sync all categories"
              : "Sync selected category"}
        </Button>
      </PageHeading>
      <div className="info-banner">
        <ShieldCheck size={15} />
        <span>
          {canManage
            ? "Pause or resume one verified listing at a time. Changes are sent to Eldorado only after your confirmation and recorded for audit."
            : "Read your authorized listing inventory. Availability changes require a separate staff permission."}{" "}
          Price, quantity, deletion, and bulk changes are not enabled here.
        </span>
      </div>
      {canManage && history.isError && (
        <QueryError
          message="Availability history could not be verified. Changes are disabled until the operation records can be read."
          retry={() => history.refetch()}
        />
      )}
      {configured && query.data && (
        <div className="catalog-summary" aria-label="Visible listing summary">
          <div>
            <span>VISIBLE SOURCE RECORDS</span>
            <strong>{rows.length}</strong>
            <small>Current filters and stored page</small>
          </div>
          <div>
            <span>
              <span className="catalog-status-dot" /> ACTIVE RECORDS
            </span>
            <strong>
              {rows.filter((offer) => offer.state === "Active").length}
            </strong>
            <small>Available in the last verified read</small>
          </div>
          <div>
            <span>
              <Pause size={11} /> PAUSED RECORDS
            </span>
            <strong>
              {rows.filter((offer) => offer.state === "Paused").length}
            </strong>
            <small>Ready for an authorized review</small>
          </div>
        </div>
      )}
      {Boolean(pendingOperations?.length) && (
        <section
          className="catalog-pending-panel"
          aria-label="Unconfirmed availability operations"
        >
          <div className="catalog-pending-notice" role="status">
            <AlertTriangle size={16} />
            <span>
              {pendingOperations!.length} recent availability operation
              {pendingOperations!.length === 1 ? " needs" : "s need"} a verified
              result. Check its outcome before starting another change to the
              same listing.
            </span>
          </div>
          {pendingOperations!.map((operation) => (
            <div className="catalog-pending-row" key={operation.id}>
              <div>
                <strong>
                  {operation.action === "pause"
                    ? "Pause listing"
                    : "Resume listing"}
                </strong>
                <code>{operation.offer_id}</code>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(latestAttempt(operation.offer_id)?.busy)}
                onClick={() => checkAvailability(operation.offer_id)}
              >
                <RefreshCw
                  size={12}
                  className={
                    latestAttempt(operation.offer_id)?.busy ? "spin" : ""
                  }
                />
                Check outcome
              </Button>
            </div>
          ))}
        </section>
      )}
      {feedback && (
        <p className="inline-feedback" role="status">
          {feedback}
        </p>
      )}
      {results.length > 0 && (
        <section
          className="data-panel"
          aria-label="Listing synchronization results"
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Result</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.source}>
                    <td>{sourceLabels[result.source]}</td>
                    <td>
                      {result.ok ? (
                        <span className="state-badge success">
                          {result.count} real listings read
                        </span>
                      ) : (
                        <span className="state-badge">{result.error.code}</span>
                      )}
                    </td>
                    <td>
                      {result.ok
                        ? `Page ${result.index} of ${result.totalPages} · ${result.recordCount} reported records${result.hasMore ? " · more upstream pages require verified request parameters" : ""}`
                        : result.error.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section
        className="data-panel"
        style={{ marginTop: results.length ? 18 : 0 }}
      >
        <div className="table-toolbar">
          <form
            className="input-search"
            onSubmit={(event) => {
              event.preventDefault();
              update("search", search);
            }}
          >
            <Search size={14} />
            <input
              aria-label="Search offers"
              placeholder="Search listing, ID, or game..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit">Search</button>
          </form>
          <label className="select-label">
            Type
            <select
              aria-label="Filter offer type"
              value={source}
              onChange={(event) => update("source", event.target.value)}
            >
              <option value="all">All listing types</option>
              {offerSources.map((value) => (
                <option key={value} value={value}>
                  {sourceLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="select-label">
            State
            <select
              aria-label="Filter offer status"
              value={state}
              onChange={(event) => update("state", event.target.value)}
            >
              <option value="">All states</option>
              {[...new Set([...(state ? [state] : []), ...states])].map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {query.isError ? (
          <QueryError
            message={query.error.message}
            retry={() => query.refetch()}
          />
        ) : query.isLoading ? (
          <div className="skeleton-panel" aria-label="Loading listings" />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Listing</th>
                    <th>Type / Game</th>
                    <th>Status</th>
                    <th>Unit price</th>
                    <th>Available</th>
                    <th>Last read</th>
                    <th>Availability control</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((offer) => {
                    const attempt = latestAttempt(offer.id),
                      action = actionForState(offer.state),
                      pending = unresolved(attempt);
                    return (
                      <tr key={offer.id}>
                        <td>
                          <strong className="table-primary">
                            {offer.title}
                          </strong>
                          <small className="mono">{offer.native_id}</small>
                        </td>
                        <td>
                          {sourceLabels[offer.source] ?? offer.category}
                          <small>{offer.game_id ?? "Game not provided"}</small>
                        </td>
                        <td>
                          <span
                            className={`state-badge${offer.state === "Active" ? " success" : ""}`}
                          >
                            {offer.state}
                          </span>
                        </td>
                        <td>
                          {offer.price !== null && offer.currency
                            ? money(Number(offer.price), offer.currency)
                            : "Not provided"}
                        </td>
                        <td>{offer.quantity ?? "Not provided"}</td>
                        <td>
                          {new Date(offer.updated_at).toLocaleString("en-US")}
                        </td>
                        <td className="catalog-control-cell">
                          {canManage ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !canChange ||
                                  Boolean(attempt?.busy) ||
                                  (!action && !pending)
                                }
                                onClick={() => openAction(offer)}
                                aria-label={`${pending ? "Check availability outcome for" : action === "pause" ? "Pause" : action === "resume" ? "Resume" : "Unavailable action for"} ${offer.title}`}
                              >
                                {attempt?.busy ? (
                                  <RefreshCw size={12} className="spin" />
                                ) : pending ? (
                                  <AlertTriangle size={12} />
                                ) : action === "pause" ? (
                                  <Pause size={12} />
                                ) : (
                                  <Play size={12} />
                                )}
                                {attempt?.busy
                                  ? "Checking…"
                                  : pending
                                    ? "Check outcome"
                                    : action === "pause"
                                      ? "Pause"
                                      : action === "resume"
                                        ? "Resume"
                                        : "State unavailable"}
                              </Button>
                              {attempt?.operation && (
                                <small
                                  className={
                                    attempt.operation.status === "succeeded"
                                      ? "catalog-verified"
                                      : ""
                                  }
                                >
                                  {outcomeLabel(attempt.operation)}
                                </small>
                              )}
                            </>
                          ) : (
                            <span className="catalog-read-only">Read only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <EmptyState
                title="A real view of your listing inventory."
                description={
                  configured
                    ? "Synchronize the selected listing type to read your authorized Eldorado listings. A failed source is reported separately and never replaced with fabricated results."
                    : "Connect secure authentication and the seller credentials to read actual listings."
                }
              />
            )}
          </>
        )}
        <div className="table-footer">
          <span>{rows.length} visible synchronized listing records</span>
          <div>
            {params.get("cursor") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update("cursor", "")}
              >
                First page
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data?.nextCursor}
              onClick={() => update("cursor", query.data!.nextCursor!)}
            >
              Next stored page
              <ArrowUpRight size={12} />
            </Button>
          </div>
        </div>
      </section>
      <p className="scope-note">
        <Clock3 size={12} /> Last successful reads:{" "}
        {query.data?.sync.length
          ? query.data.sync
              .map(
                (entry) =>
                  `${entry.provider.replace("eldorado-offers:", "")}: ${entry.last_success_at ? new Date(entry.last_success_at).toLocaleString("en-US") : "not yet"}`,
              )
              .join(" · ")
          : "No synchronization has been recorded."}
      </p>
      <p className="scope-note catalog-coverage-note">
        Actions require a fresh upstream read of the selected listing. Source
        coverage is limited to verified request parameters; a listing outside
        that coverage cannot be changed here. Sources may overlap: record counts
        do not represent a unique listing total.
      </p>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {selectedAttempt
              ? "Availability operation"
              : selectedAction === "pause"
                ? "Pause this Eldorado listing?"
                : "Resume this Eldorado listing?"}
          </DialogTitle>
          <DialogDescription>
            This changes the listing on Eldorado. Your staff identity, reason,
            and verified result are recorded. Existing orders are not cancelled
            by this action.
          </DialogDescription>
          {selected && (
            <div className="catalog-change-summary">
              <strong>{selected.title}</strong>
              <code>{selected.native_id}</code>
              <div>
                <span>Listing type</span>
                <b>{sourceLabels[selected.source]}</b>
              </div>
              <div>
                <span>Last known state</span>
                <b>{selected.state}</b>
              </div>
              <div>
                <span>Unit price / quantity</span>
                <b>
                  {selected.price !== null && selected.currency
                    ? money(Number(selected.price), selected.currency)
                    : "Not provided"}{" "}
                  / {selected.quantity ?? "Not provided"}
                </b>
              </div>
              <div>
                <span>Requested change</span>
                <b>
                  {selectedAttempt?.operation?.action ??
                    selectedAttempt?.request?.action ??
                    selectedAction ??
                    "None"}
                </b>
              </div>
            </div>
          )}
          {selectedAttempt ? (
            <div className="catalog-operation-result" aria-live="polite">
              <div
                className={`catalog-outcome ${selectedAttempt.operation?.status === "succeeded" ? "is-verified" : ""}`}
              >
                {selectedAttempt.operation?.status === "succeeded" ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <AlertTriangle size={18} />
                )}
                <strong>
                  {selectedAttempt.busy
                    ? "Verifying operation…"
                    : selectedAttempt.operation
                      ? outcomeLabel(selectedAttempt.operation)
                      : selectedAttempt.missing
                        ? "No accepted operation found"
                        : "Outcome needs checking"}
                </strong>
              </div>
              {selectedAttempt.message && <p>{selectedAttempt.message}</p>}
              {selectedAttempt.operation?.observed_state && (
                <p>
                  Observed Eldorado state:{" "}
                  <strong>{selectedAttempt.operation.observed_state}</strong>
                </p>
              )}
              {selected && unresolved(selectedAttempt) && (
                <Button
                  variant="outline"
                  disabled={selectedAttempt.busy}
                  onClick={() => checkAvailability(selected.id)}
                >
                  <RefreshCw
                    size={13}
                    className={selectedAttempt.busy ? "spin" : ""}
                  />
                  {selectedAttempt.busy
                    ? "Checking…"
                    : "Check outcome without resending"}
                </Button>
              )}
              <p className="catalog-recovery-note">
                Closing this window does not cancel or repeat the operation. A
                new change always needs a new confirmation.
              </p>
            </div>
          ) : (
            <form
              className="catalog-confirm-form"
              onSubmit={(event) => {
                event.preventDefault();
                void executeAvailability();
              }}
            >
              <label className="field-label">
                Reason for this change
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain why this listing should be paused or resumed…"
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm this availability change should be applied to the
                Eldorado listing shown above.
              </label>
              <Button
                type="submit"
                disabled={
                  !canChange ||
                  !selectedAction ||
                  !confirmed ||
                  reason.trim().length < 10
                }
              >
                {selectedAction === "pause" ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}
                Confirm {selectedAction ?? "change"} on Eldorado
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
