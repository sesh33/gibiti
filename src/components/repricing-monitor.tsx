"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, Zap } from "lucide-react";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import type { PricingPolicy, PricingQuote } from "@/domains/pricing/models";
export function RepricingMonitor({ configured }: { configured: boolean }) {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const allowed =
    configured && !!me.data?.permissions.includes("offers.update_price");
  const rules = useQuery({
    queryKey: ["pricing-policies", "all"],
    queryFn: () => api<{ items: PricingPolicy[] }>("/api/pricing/policies"),
    enabled: allowed,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["pricing-history", "all"],
    queryFn: () => api<{ items: PricingQuote[] }>("/api/pricing/history"),
    enabled: allowed,
    retry: false,
    refetchInterval: 15000,
  });
  const items = rules.data?.items ?? [],
    automatic = items.filter(
      (item) => item.mode === "automatic" && item.review_status === "approved",
    ),
    pending = items.filter(
      (item) => item.mode === "automatic" && item.review_status !== "approved",
    );
  return (
    <section className="repricing-live" aria-label="Repricing live monitor">
      <span className="eyebrow">
        <Zap size={14} style={{ display: "inline" }} /> PRECISION REPRICING
        ENGINE
      </span>
      <div className="engine-cadence">
        <span>MINIMUM CHECK INTERVAL</span>
        <strong>
          15<small>sec</small>
        </strong>
        <span>Provider limits respected</span>
      </div>
      <h2>Compete on price. Keep your floor.</h2>
      <p className="scope-note">
        Price checks can run at a 15-second minimum interval. Actual cadence
        depends on provider latency, queued listings and cooldowns.
        Complete-market matching and a fresh pre-write check protect every
        adjustment.
      </p>
      <div className="engine-steps">
        <span>
          <i>01</i> Verify equivalent offers
        </span>
        <span>
          <i>02</i> Apply your floor & difference
        </span>
        <span>
          <i>03</i> Confirm the real outcome
        </span>
      </div>
      <div className="repricing-status-grid">
        <div>
          <strong>{rules.data ? items.length : "—"}</strong>
          <span>Visible saved pricing rules</span>
        </div>
        <div>
          <strong>{rules.data ? automatic.length : "—"}</strong>
          <span>Approved automatic rules · master switch required</span>
        </div>
        <div>
          <strong>{rules.data ? pending.length : "—"}</strong>
          <span>Automatic rules awaiting review</span>
        </div>
      </div>
      <p className="scope-note">
        For USD, <strong>$0.00001 = 0.001 cents</strong>. Set at least five
        decimal places to represent that difference. Listing prices and floors
        retain up to eight decimal places. Only equivalent in-stock competitors
        count; unknown metadata blocks repricing.
      </p>
      {rules.isError && <p role="alert">{rules.error.message}</p>}
      {history.isError && <p role="alert">{history.error.message}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Market check</th>
              <th>Proposed unit price</th>
              <th>Lowest verified competitor</th>
              <th>Floor used</th>
              <th>Verified peers</th>
            </tr>
          </thead>
          <tbody>
            {history.data?.items.slice(0, 8).map((quote) => (
              <tr key={quote.id}>
                <td>{new Date(quote.created_at).toLocaleString()}</td>
                <td>{unitPrice(Number(quote.amount), quote.currency)}</td>
                <td>
                  {typeof quote.proof.minimum === "number"
                    ? unitPrice(quote.proof.minimum, quote.currency)
                    : "Not recorded"}
                </td>
                <td>
                  {typeof quote.proof.configuredFloor === "number"
                    ? unitPrice(quote.proof.configuredFloor, quote.currency)
                    : "Not recorded"}
                </td>
                <td>{String(quote.proof.equivalentOffers ?? "Unknown")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!history.data?.items.length && (
        <p className="scope-note">
          <Activity size={14} style={{ display: "inline" }} /> No visible market
          checks yet. Save a floor on an offer, simulate it, then review and
          explicitly enable any automatic rule.
        </p>
      )}
      <p className="scope-note">
        These are persisted calculations, not proof that a price was changed.
        Actual acknowledgments and verified outcomes are recorded in{" "}
        <Link href="/approvals">Approvals</Link>. This monitor refreshes
        database history, not the Eldorado market.
      </p>
    </section>
  );
}
