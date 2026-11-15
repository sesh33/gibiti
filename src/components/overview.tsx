"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  CircleHelp,
  PackageCheck,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { EmptyState, QueryError } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { money } from "@/lib/utils";
import type { OrderStateBucket } from "@/domains/orders/states";
import { OperationalSummary } from "@/components/operational-summary";
import { WorkspaceHero } from "@/components/workspace-hero";
type Metrics = {
  orders: number;
  completed: number;
  pending: number;
  received: number;
  canceled: number;
  other: number;
  stateBreakdown: { state: string; count: number; bucket: OrderStateBucket }[];
  completedVolume: Record<string, number>;
  scope: string;
  limit: number;
};
export function Overview({ configured }: { configured: boolean }) {
  const query = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api<Metrics>("/api/workspace/analytics"),
    enabled: configured,
    refetchInterval: 60000,
  });
  const data = query.data;
  const stateBreakdown = data?.stateBreakdown ?? [];
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONAL OVERVIEW"
        title="A clearer view of your operation."
        description="Actionable context from the records your workspace has actually synchronized."
      >
        <Button variant="outline" asChild>
          <Link href="/orders">
            Open order center
            <ArrowUpRight size={14} />
          </Link>
        </Button>
      </PageHeading>
      <WorkspaceHero configured={configured} />
      <div
        className="metric-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        {[
          {
            label: "Synchronized orders",
            value: data?.orders,
            icon: ShoppingBag,
          },
          { label: "Known open orders", value: data?.pending, icon: Clock3 },
          {
            label: "Received orders",
            value: data?.received,
            icon: PackageCheck,
            detail: "Delivery confirmed; excluded from completed volume",
          },
          {
            label: "Completed orders",
            value: data?.completed,
            icon: CheckCircle2,
          },
          {
            label: "Canceled orders",
            value: data?.canceled,
            icon: TriangleAlert,
          },
          {
            label: "Other / unclassified",
            value: data?.other,
            icon: CircleHelp,
          },
        ].map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div>
              <span>{metric.label}</span>
              <metric.icon size={16} />
            </div>
            <strong>{metric.value ?? "—"}</strong>
            <small>
              {data
                ? (metric.detail ?? "Visible synchronized records")
                : "Awaiting authenticated synchronization"}
            </small>
          </article>
        ))}
      </div>
      {query.isError && <QueryError message={query.error.message} />}
      <OperationalSummary configured={configured} />
      {stateBreakdown.length > 0 && (
        <section
          className="data-panel"
          aria-label="Exact synchronized order states"
          style={{ marginBottom: 18 }}
        >
          <div className="panel-title">
            <h2>States reported by Eldorado</h2>
            <span className="pill pill-muted">Exact labels</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Upstream state</th>
                  <th>Orders</th>
                  <th>Metric group</th>
                </tr>
              </thead>
              <tbody>
                {stateBreakdown.map(({ state, count, bucket }) => (
                  <tr key={state}>
                    <td>
                      <Link
                        className="table-primary"
                        href={`/orders?state=${encodeURIComponent(state)}`}
                      >
                        {state}
                      </Link>
                    </td>
                    <td>{count}</td>
                    <td>
                      {bucket === "pending"
                        ? "Known open"
                        : bucket === "received"
                          ? "Delivery confirmed"
                          : bucket === "other"
                            ? "Unclassified"
                            : bucket === "completed"
                              ? "Completed"
                              : "Canceled"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="scope-note" style={{ margin: "14px 18px" }}>
            Received confirms delivery, not released funds or Completed volume.{" "}
            Unclassified labels are preserved exactly. They are not counted as
            work awaiting processing or completed sales.
          </p>
        </section>
      )}
      <div className="overview-grid">
        <section className="data-panel">
          <div className="panel-title">
            <h2>Completed order volume</h2>
            <span className="pill pill-muted">Partial history</span>
          </div>
          {data && Object.keys(data.completedVolume).length ? (
            <div className="volume-list">
              {Object.entries(data.completedVolume).map(
                ([currency, amount]) => (
                  <div key={currency}>
                    <span>{currency}</span>
                    <strong>{money(amount, currency)}</strong>
                  </div>
                ),
              )}
            </div>
          ) : (
            <EmptyState
              title={
                data
                  ? "No Completed orders in this scope."
                  : "Completed volume awaits authenticated data."
              }
              description={
                data
                  ? "Only orders whose exact state is Completed contribute to this volume, grouped by currency across up to 1,000 synchronized records. Other states do not count as completed sales."
                  : "No financial total is inferred before synchronized records are available."
              }
            />
          )}
        </section>
        <section className="data-panel overview-readiness">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h2>Build on a secure foundation.</h2>
          <div>
            <ShieldIcon /> Individual accounts & database permissions
          </div>
          <div>
            <ShieldIcon /> Audited internal operations
          </div>
          <div>
            {data && data.orders > 0 ? (
              <>
                <ShieldIcon /> Orders synchronized
              </>
            ) : (
              <>
                <Clock3 size={16} /> No synchronized orders yet
              </>
            )}
          </div>
          <div>
            <Clock3 size={16} /> Reply library available to copy
          </div>
          <Link href="/settings" className="empty-link">
            Workspace configuration
            <ArrowUpRight size={13} />
          </Link>
        </section>
      </div>
      <p className="scope-note">
        {data?.scope ??
          "Metrics stay empty until authenticated data is available."}{" "}
        Employee productivity and processing-time reports require complete
        operational history and are not yet implemented.
      </p>
    </>
  );
}
function ShieldIcon() {
  return <CheckCircle2 size={16} />;
}
