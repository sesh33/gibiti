"use client";
import { TableScroll } from "@/components/table-scroll";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, Zap } from "lucide-react";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import type { PricingPolicy, PricingQuote } from "@/domains/pricing/models";
function estimateValue(quote: PricingQuote, key: string) {
  const value = quote.proof.economics;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const number = (value as Record<string, unknown>)[key];
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}
function observedAt(quote: PricingQuote) {
  const value = quote.proof.observedAt;
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Not recorded";
}
export function RepricingMonitor({ configured }: { configured: boolean }) {
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setClock(Date.now()), 0),
      timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
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
    <section
      className="repricing-live commerce-pricing-engine"
      aria-label="Repricing live monitor"
    >
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
      <h2>Compete on price. Protect your margin.</h2>
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
          <i>02</i> Check fees, margin & floor
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
        count; unknown metadata blocks repricing. Valid Owner cost and fee
        estimates are required before execution. They do not represent actual
        settlement data from Eldorado.
      </p>
      {rules.isError && <p role="alert">{rules.error.message}</p>}
      {history.isError && <p role="alert">{history.error.message}</p>}
      <TableScroll label="Pricing simulation history">
        <table>
          <thead>
            <tr>
              <th>Market collected</th>
              <th>Proposed unit price</th>
              <th>Lowest verified competitor</th>
              <th>Effective unit floor</th>
              <th>Estimated basket fees</th>
              <th>Estimated net revenue</th>
              <th>Estimated margin</th>
              <th>Verified peers</th>
              <th>Execution</th>
            </tr>
          </thead>
          <tbody>
            {history.data?.items.slice(0, 8).map((quote) => {
              const fees = estimateValue(quote, "fees"),
                net = estimateValue(quote, "netRevenue"),
                margin = estimateValue(quote, "marginPercent"),
                quantity = estimateValue(quote, "comparisonQuantity"),
                fresh =
                  clock !== null &&
                  Date.parse(quote.expires_at) > clock &&
                  typeof quote.proof.validUntil === "string" &&
                  Date.parse(quote.proof.validUntil) > clock;
              return (
                <tr key={quote.id}>
                  <td>{observedAt(quote)}</td>
                  <td>{unitPrice(Number(quote.amount), quote.currency)}</td>
                  <td>
                    {typeof quote.proof.minimum === "number"
                      ? unitPrice(quote.proof.minimum, quote.currency)
                      : "Not recorded"}
                  </td>
                  <td>
                    {typeof quote.proof.effectiveFloor === "number"
                      ? unitPrice(quote.proof.effectiveFloor, quote.currency)
                      : "Not recorded"}
                  </td>
                  <td>
                    {fees === null
                      ? "Assumptions required"
                      : unitPrice(fees, quote.currency)}
                    {quantity !== null && <small> · {quantity} units</small>}
                  </td>
                  <td>{net === null ? "—" : unitPrice(net, quote.currency)}</td>
                  <td>{margin === null ? "—" : `${margin.toFixed(2)}%`}</td>
                  <td>{String(quote.proof.equivalentOffers ?? "Unknown")}</td>
                  <td>
                    {quote.proof.executable !== true
                      ? typeof quote.proof.blockedReason === "string"
                        ? `Blocked: ${quote.proof.blockedReason}`
                        : "Simulation only"
                      : fresh
                        ? "Fresh · policy checks apply"
                        : "Expired · simulate again"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
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
