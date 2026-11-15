"use client";
import { TableScroll } from "@/components/table-scroll";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  RefreshCw,
  Search,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/page-heading";
import { OperationPanelHeading } from "@/components/operation-guide";
import { EmptyState, QueryError } from "@/components/empty-state";
import { api, ApiError } from "@/lib/api-client";
import { money } from "@/lib/utils";
import { orderStateOptions } from "@/domains/orders/states";
export type OrderRow = {
  id: string;
  buyer_username: string;
  product_title: string;
  amount: number;
  currency: string;
  quantity: number;
  state: string;
  purchased_at: string;
  conversation_ref: string | null;
};
export function OrderCenter({ configured }: { configured: boolean }) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname(),
    cache = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? ""),
    [notice, setNotice] = useState(""),
    [upstreamCursor, setUpstreamCursor] = useState<string | null>(null);
  const access = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const canSync = Boolean(access.data?.permissions.includes("orders.read"));
  const preferences = useQuery({
    queryKey: ["staff-preferences"],
    queryFn: () =>
      api<{ orderPollingEnabled: boolean; orderPollingSeconds: number }>(
        "/api/preferences",
      ),
    enabled: configured && canSync,
    retry: false,
  });
  const savePreferences = useMutation({
    mutationFn: (next: {
      orderPollingEnabled: boolean;
      orderPollingSeconds: number;
    }) =>
      api<{ orderPollingEnabled: boolean; orderPollingSeconds: number }>(
        "/api/preferences",
        { method: "POST", body: JSON.stringify(next) },
      ),
    onSuccess: (data) => cache.setQueryData(["staff-preferences"], data),
    onError: (error) => setNotice(error.message),
  });
  const polling = preferences.data?.orderPollingEnabled ?? false,
    pollSeconds = preferences.data?.orderPollingSeconds ?? 60;
  useEffect(() => {
    if (!configured || !polling || !canSync) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      delay = pollSeconds * 1000,
      notBefore = Date.now() + pollSeconds * 1000;
    async function poll() {
      if (cancelled) return;
      if (Date.now() < notBefore) {
        timer = setTimeout(poll, Math.min(notBefore - Date.now(), 2147483647));
        return;
      }
      if (!document.hidden) {
        try {
          await api("/api/orders/sync", { method: "POST", body: "{}" });
          if (cancelled) return;
          delay = pollSeconds * 1000;
          await cache.invalidateQueries({ queryKey: ["orders"] });
        } catch (error) {
          if (cancelled) return;
          delay = Math.max(
            pollSeconds * 1000,
            Math.min(900000, delay * 2),
            error instanceof ApiError ? (error.retryAfter ?? 0) * 1000 : 0,
          );
          setNotice(
            `${error instanceof Error ? error.message : "Order sync unavailable."} Auto-sync will wait before trying another read.`,
          );
        }
      }
      if (!cancelled) {
        notBefore = Date.now() + delay;
        timer = setTimeout(poll, Math.min(delay, 2147483647));
      }
    }
    timer = setTimeout(poll, Math.min(delay, 2147483647));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [configured, polling, canSync, pollSeconds, cache]);
  const state = params.get("state") ?? "all",
    sort = params.get("sort") ?? "newest";
  const orders = useQuery({
    queryKey: ["orders", params.toString()],
    queryFn: () =>
      api<{
        items: OrderRow[];
        nextCursor: string | null;
        observedStates?: string[];
        scope: string;
      }>(`/api/orders?${params}`),
    enabled: configured,
    refetchInterval: 60000,
  });
  const sync = useMutation({
    mutationFn: () =>
      api<{ count: number; nextCursor: string | null }>("/api/orders/sync", {
        method: "POST",
        body: JSON.stringify(upstreamCursor ? { cursor: upstreamCursor } : {}),
      }),
    onSuccess: (data) => {
      setUpstreamCursor(data.nextCursor);
      setNotice(
        `Synchronized ${data.count} orders from one upstream page.${data.nextCursor ? " More pages are available." : " End of the returned page set."}`,
      );
      cache.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => setNotice(error.message),
  });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "cursor") next.delete("cursor");
    router.push(`${pathname}?${next}`);
  }
  return (
    <div className="ops-workspace orders-workspace">
      <PageHeading
        eyebrow="SELLER OPERATIONS"
        title="Order center"
        description="One source of context for every order in your operation."
      >
        <Button
          variant="outline"
          disabled={!configured || !canSync || sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw size={14} className={sync.isPending ? "spin" : ""} />
          {sync.isPending
            ? "Synchronizing..."
            : upstreamCursor
              ? "Sync next API page"
              : "Sync orders"}
        </Button>
      </PageHeading>
      <div className="info-banner ops-scope-banner">
        <ShoppingBag size={14} />
        <span>
          Read-only Eldorado synchronization. Results are limited to the pages
          you have synchronized and your permissions.
        </span>
      </div>
      {canSync && (
        <div className="reply-toolbar ops-sync-toolbar">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={polling}
              disabled={!preferences.isSuccess || savePreferences.isPending}
              onChange={(event) =>
                savePreferences.mutate({
                  orderPollingEnabled: event.target.checked,
                  orderPollingSeconds: pollSeconds,
                })
              }
            />
            Auto-sync new orders while this page is visible
          </label>
          <label className="field-label">
            Read interval
            <select
              value={pollSeconds}
              aria-label="Read interval"
              disabled={!preferences.isSuccess || savePreferences.isPending}
              onChange={(event) =>
                savePreferences.mutate({
                  orderPollingEnabled: polling,
                  orderPollingSeconds: Number(event.target.value),
                })
              }
            >
              {[30, 60, 120, 300].map((value) => (
                <option key={value} value={value}>
                  {value} seconds
                </option>
              ))}
            </select>
          </label>
          {upstreamCursor && (
            <Button variant="ghost" onClick={() => setUpstreamCursor(null)}>
              Restart API pagination
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="inline-feedback">
          {notice}
        </p>
      )}
      <section className="data-panel ops-directory-panel">
        <OperationPanelHeading
          icon={ShoppingBag}
          title="Order workspace"
          description="Find the right order. Keep every next step in context."
          label="SYNCHRONIZED RECORDS"
        />
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
              aria-label="Search orders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search buyer or product..."
            />
            <button type="submit">Search</button>
          </form>
          <label className="select-label">
            Status
            <select
              aria-label="Filter order status"
              value={state}
              onChange={(e) => update("state", e.target.value)}
            >
              {[
                "all",
                ...orderStateOptions(
                  orders.data?.observedStates ??
                    orders.data?.items.map((order) => order.state) ??
                    [],
                  state,
                ),
              ].map((value) => (
                <option value={value} key={value}>
                  {value === "all" ? "All statuses" : value}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update("sort", sort === "newest" ? "oldest" : "newest")
            }
          >
            <ArrowDownUp size={13} />
            {sort === "newest" ? "Newest first" : "Oldest first"}
          </Button>
        </div>
        {orders.isError ? (
          <QueryError
            message={orders.error.message}
            retry={() => orders.refetch()}
          />
        ) : orders.isLoading ? (
          <div className="skeleton-panel" />
        ) : (
          <>
            <TableScroll label="Synchronized orders">
              <table>
                <thead>
                  <tr>
                    <th>Order / Buyer</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Quantity</th>
                    <th>Amount</th>
                    <th>Purchased</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orders.data?.items.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <div className="ops-person">
                          <span
                            className="ops-person-avatar"
                            aria-hidden="true"
                          >
                            {order.buyer_username.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <Link
                              className="table-primary"
                              href={`/orders/${order.id}`}
                            >
                              {order.buyer_username}
                            </Link>
                            <small>{order.id.slice(0, 8).toUpperCase()}</small>
                          </span>
                        </div>
                      </td>
                      <td>{order.product_title}</td>
                      <td>
                        <span
                          className={`state-badge ${order.state === "Completed" ? "success" : ""}`}
                        >
                          {order.state}
                        </span>
                      </td>
                      <td>
                        <span className="ops-quantity">{order.quantity}</span>
                      </td>
                      <td className="ops-money">
                        {money(Number(order.amount), order.currency)}
                      </td>
                      <td>
                        {new Date(order.purchased_at).toLocaleDateString(
                          "en-US",
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/orders/${order.id}`}
                          aria-label={`Open order ${order.id}`}
                        >
                          <ArrowUpRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            {!orders.data?.items.length && (
              <EmptyState
                title="Your operation starts with the first sync."
                description={
                  configured
                    ? "Synchronize an authorized API page to view orders. Assigned-only staff see only orders assigned to them."
                    : "Connect Supabase and the Eldorado Seller API to start synchronizing real orders."
                }
                action={{ href: "/settings", label: "View integration setup" }}
              />
            )}
          </>
        )}
        <div className="table-footer">
          <span>
            {orders.data?.items.length ?? 0} visible orders · synchronized
            records only
          </span>
          <div>
            {params.get("cursor") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update("cursor", "")}
              >
                First page
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!orders.data?.nextCursor}
              onClick={() => update("cursor", orders.data!.nextCursor!)}
            >
              Next page <ArrowUpRight size={12} />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
