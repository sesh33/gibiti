"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { EmptyState, QueryError } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { money } from "@/lib/utils";
type Metrics = {
  orders: number;
  completed: number;
  pending: number;
  canceled: number;
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
      <div className="metric-grid">
        {[
          {
            label: "Synchronized orders",
            value: data?.orders,
            icon: ShoppingBag,
          },
          { label: "Pending processing", value: data?.pending, icon: Clock3 },
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
        ].map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div>
              <span>{metric.label}</span>
              <metric.icon size={16} />
            </div>
            <strong>{metric.value ?? "—"}</strong>
            <small>
              {data
                ? "Visible synchronized records"
                : "Awaiting authenticated synchronization"}
            </small>
          </article>
        ))}
      </div>
      {query.isError && <QueryError message={query.error.message} />}
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
              title="Real numbers. No invented growth."
              description="Completed order volume is calculated by currency from up to 1,000 synchronized records. No currencies are combined and no account-wide totals are inferred."
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
            <Clock3 size={16} /> Official messaging access required
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
