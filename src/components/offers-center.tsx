"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-heading";
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
export function OffersCenter({ configured }: { configured: boolean }) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname(),
    cache = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? ""),
    [results, setResults] = useState<SyncResult[]>([]),
    [feedback, setFeedback] = useState("");
  const source = params.get("source") ?? "all",
    state = params.get("state") ?? "";
  const query = useQuery({
    queryKey: ["offers", params.toString()],
    queryFn: () => api<ReadPage>(`/api/offers?${params}`),
    enabled: configured,
    refetchInterval: 60000,
  });
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
  const rows = query.data?.items ?? [];
  const states = [...new Set(rows.map((row) => row.state))].sort();
  return (
    <>
      <PageHeading
        eyebrow="LISTING OPERATIONS"
        title="Offers, without the clutter."
        description="Your real listings. Read-only synchronization. Clear pricing and availability."
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
          Only official seller GET endpoints are used. Price, stock, pause,
          deletion, and bulk changes are not enabled. Upstream pagination
          remains limited to the verified first-page request; stored records
          have local cursor pagination.
        </span>
      </div>
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
                  </tr>
                </thead>
                <tbody>
                  {rows.map((offer) => (
                    <tr key={offer.id}>
                      <td>
                        <strong className="table-primary">{offer.title}</strong>
                        <small className="mono">{offer.native_id}</small>
                      </td>
                      <td>
                        {sourceLabels[offer.source] ?? offer.category}
                        <small>{offer.game_id ?? "Game not provided"}</small>
                      </td>
                      <td>
                        <span className="state-badge">{offer.state}</span>
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
                    </tr>
                  ))}
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
          <span>{rows.length} visible synchronized listings</span>
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
    </>
  );
}
