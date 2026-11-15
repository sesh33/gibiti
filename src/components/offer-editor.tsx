"use client";
import { TableScroll } from "@/components/table-scroll";
import Link from "next/link";
import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { unitPrice } from "@/lib/utils";
import { CommerceWorkflow } from "@/components/commerce-workflow";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { PredefinedFields } from "@/components/predefined-fields";
import { PricingControls } from "@/components/pricing-controls";
import {
  changeLabels,
  requiredChangePermissions,
  marketplaceChange,
  type MarketplaceChange,
} from "@/domains/eldorado/contracts";

const initialDocument = {
  details: {
    description: "",
    guaranteedDeliveryTime: "Minute20",
    pricing: {
      quantity: 1,
      minQuantity: 1,
      volumeDiscounts: [],
      pricePerUnit: { amount: 1, currency: "USD" },
    },
    deliveryMethod: "InGameTrade",
  },
  augmentedGame: {
    gameId: "",
    category: "CustomItem",
    tradeEnvironmentId: null,
    offerAttributes: [],
  },
  giftCardDetails: null,
};
type Snapshot = {
  local: { id: string; title: string; updated_at: string };
  snapshot: {
    state: string;
    price: number;
    currency: string;
    quantity: number;
    context?: {
      unitSystem: string | null;
      minQuantity: number | null;
      deliveryMethod: string | null;
    };
    document: unknown | null;
  };
};
export function OfferEditor({ configured }: { configured: boolean }) {
  const params = useSearchParams(),
    target = params.get("id"),
    create = !target;
  const [kind, setKind] = useState<MarketplaceChange["kind"]>(
    create ? "offer.create" : "offer.price",
  );
  const [amount, setAmount] = useState(""),
    [quantity, setQuantity] = useState(""),
    [document, setDocument] = useState(
      JSON.stringify(initialDocument, null, 2),
    );
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [comparePage, setComparePage] = useState(1);
  const key = useRef<string | null>(null),
    cache = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ permissions: string[] }>("/api/me"),
    enabled: configured,
  });
  const source = useQuery({
    queryKey: ["offer-edit", target],
    queryFn: () =>
      api<Snapshot>(
        `/api/marketplace/offers/${encodeURIComponent(target!.replace(/^predefined:/, ""))}`,
      ),
    enabled: configured && !!target,
    retry: false,
  });
  const comparison = useQuery({
    queryKey: ["offer-comparison", target, comparePage],
    queryFn: () =>
      api<{
        items: {
          id: string;
          price: number;
          currency: string;
          quantity: number;
          unit: string;
          deliveryMethod: string;
        }[];
        message: string;
        page?: number;
        totalPages?: number;
      }>(
        `/api/marketplace/offers/${encodeURIComponent(target!.replace(/^predefined:/, ""))}/comparison?page=${comparePage}`,
      ),
    enabled: false,
    retry: false,
  });
  const allowed = Boolean(
    requiredChangePermissions(kind).every((permission) =>
      me.data?.permissions.includes(permission),
    ) && me.data?.permissions.includes("offers.read"),
  );
  const eligible =
    create || ["Active", "Paused"].includes(source.data?.snapshot.state ?? "");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || submitted) return;
    setNotice("");
    try {
      const change = marketplaceChange.parse(
        kind === "offer.price"
          ? {
              kind,
              body: {
                amount: Number(amount),
                currency: source.data?.snapshot.currency,
              },
            }
          : kind === "offer.quantity"
            ? { kind, body: quantity.trim() ? Number(quantity) : NaN }
            : { kind, body: JSON.parse(document) },
      );
      key.current ??= crypto.randomUUID();
      setBusy(true);
      await api("/api/marketplace/requests", {
        method: "POST",
        body: JSON.stringify({
          target: target ?? "new",
          expectedSnapshot: source.data?.local.updated_at ?? null,
          reason,
          idempotencyKey: key.current,
          confirm: true,
          change,
        }),
      });
      setSubmitted(true);
      setNotice(
        "Request recorded. A different authorized person must review it in Approvals before execution.",
      );
      await cache.invalidateQueries({ queryKey: ["approvals"] });
    } catch (error) {
      setNotice(
        error instanceof SyntaxError
          ? "The offer document is not valid JSON."
          : error instanceof Error && error.name !== "ZodError"
            ? error.message
            : "Check the required fields and contract formats before submitting.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="commerce-page commerce-editor">
      <Link className="back-link" href="/offers">
        <ArrowLeft size={14} />
        Offers
      </Link>
      <PageHeading
        eyebrow="CONTROLLED CATALOG CHANGES"
        title={
          create ? "Create a predefined offer." : "Edit with a clear record."
        }
        description={
          create
            ? "Use confirmed game and attribute IDs. Review the complete offer before requesting creation."
            : (source.data?.local.title ??
              "Read current marketplace values before preparing a change.")
        }
      />
      <CommerceWorkflow
        steps={[
          {
            title: "Read the listing",
            description: "Start with verified marketplace values",
          },
          {
            title: "Prepare the change",
            description: "Keep product details and limits explicit",
          },
          {
            title: "Review & execute",
            description: "Independent approval before a write",
          },
        ]}
      />
      <div className="info-banner">
        <ShieldCheck size={17} />
        <span>
          Requests require independent review. Execution is a separate, explicit
          step in Approvals. Uncertain outcomes block another change.
        </span>
      </div>
      {notice && (
        <p className="inline-feedback" role="status">
          {notice} <Link href="/approvals">Open Approvals →</Link>
        </p>
      )}
      {source.isError && <p role="alert">{source.error.message}</p>}
      <div className="settings-grid" style={{ marginTop: 24 }}>
        <section className="data-panel settings-section">
          {source.data && (
            <div className="capability-list">
              <div>
                <span>Current state</span>
                <strong>{source.data.snapshot.state}</strong>
              </div>
              <div>
                <span>Current unit price</span>
                <strong>
                  {unitPrice(
                    source.data.snapshot.price,
                    source.data.snapshot.currency,
                  )}
                </strong>
              </div>
              <div>
                <span>Current quantity</span>
                <strong>{source.data.snapshot.quantity}</strong>
              </div>
              <div>
                <span>Price unit reported by Eldorado</span>
                <strong>
                  {source.data.snapshot.context?.unitSystem ?? "Not provided"}
                </strong>
              </div>
              <div>
                <span>Minimum purchase quantity</span>
                <strong>
                  {source.data.snapshot.context?.minQuantity ?? "Not provided"}
                </strong>
              </div>
              <div>
                <span>Delivery method</span>
                <strong>
                  {source.data.snapshot.context?.deliveryMethod ??
                    "Not provided"}
                </strong>
              </div>
            </div>
          )}
          {!eligible && (
            <p role="alert">
              This state cannot be edited here. Only Active and Paused listings
              are eligible.
            </p>
          )}
          <form onSubmit={submit} className="catalog-editor-form">
            {!create && (
              <label className="field-label">
                Operation
                <select
                  aria-label="Operation"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as MarketplaceChange["kind"]);
                    setConfirmed(false);
                  }}
                  disabled={busy || submitted}
                >
                  {(["offer.price", "offer.quantity", "offer.details"] as const)
                    .filter((value) =>
                      requiredChangePermissions(value).every((permission) =>
                        me.data?.permissions.includes(permission),
                      ),
                    )
                    .map((value) => (
                      <option key={value} value={value}>
                        {changeLabels[value]}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {kind === "offer.price" ? (
              <label className="field-label">
                New unit price (
                {source.data?.snapshot.currency ?? "listing currency"})
                <input
                  required
                  type="number"
                  step="any"
                  min="0"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={String(source.data?.snapshot.price ?? "")}
                  disabled={busy || submitted}
                />
              </label>
            ) : kind === "offer.quantity" ? (
              <label className="field-label">
                New quantity
                <input
                  required
                  type="number"
                  step="1"
                  min="0"
                  max="2147483647"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={busy || submitted}
                />
              </label>
            ) : (
              <>
                {!create && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !source.data?.snapshot.document || busy || submitted
                    }
                    onClick={() =>
                      setDocument(
                        JSON.stringify(source.data?.snapshot.document, null, 2),
                      )
                    }
                  >
                    Load current details
                  </Button>
                )}
                {!create && !source.data?.snapshot.document && (
                  <p className="scope-note">
                    This listing has environment or attribute selections that
                    cannot be reconstructed safely. Paste the complete DTO from
                    your verified catalog data and preserve those selections.
                  </p>
                )}
                <PredefinedFields
                  document={document}
                  onChange={setDocument}
                  disabled={busy || submitted}
                />
                <details>
                  <summary>Advanced offer document and attributes</summary>
                  <label className="field-label">
                    Complete predefined offer document
                    <textarea
                      aria-label="Complete predefined offer document"
                      rows={18}
                      className="mono"
                      value={document}
                      onChange={(event) => setDocument(event.target.value)}
                      disabled={busy || submitted}
                    />
                  </label>
                </details>
                <p className="scope-note">
                  Confirm game, category, trade environment and attribute IDs.
                  Gift-card secret imports are not accepted by this editor; use
                  null or an empty list.
                </p>
              </>
            )}
            <label className="field-label">
              Reason for this change
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy || submitted}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={busy || submitted}
              />
              I have verified this listing, its values and the requested
              operation.
            </label>
            <Button
              disabled={
                !configured ||
                !allowed ||
                !eligible ||
                (!create && !source.data) ||
                !confirmed ||
                reason.trim().length < 10 ||
                busy ||
                submitted
              }
            >
              {busy ? "Recording request…" : "Request independent review"}
            </Button>
            {!allowed && configured && (
              <p className="scope-note">
                Your Owner controls access to this operation.
              </p>
            )}
          </form>
        </section>
        {!create && (
          <section className="data-panel settings-section">
            <h2>Comparable public offers</h2>
            <p className="scope-note">
              Exact package, delivery, environment, unit and currency matches
              only. Prices remain under manual control.
            </p>
            <Button
              variant="outline"
              disabled={!source.data || comparison.isFetching}
              onClick={() => comparison.refetch()}
            >
              {comparison.isFetching
                ? "Reading comparisons…"
                : "Compare this page"}
            </Button>
            <label className="field-label">
              Public results page
              <input
                type="number"
                min="1"
                max="1000"
                value={comparePage}
                onChange={(event) =>
                  setComparePage(Number(event.target.value) || 1)
                }
              />
            </label>
            {comparison.isError && (
              <p role="alert">{comparison.error.message}</p>
            )}
            {comparison.data && (
              <>
                <p className="scope-note">{comparison.data.message}</p>
                <p>
                  {comparison.data.items.length} exact matches on page{" "}
                  {comparison.data.page ?? comparePage} of{" "}
                  {comparison.data.totalPages ?? "unknown"}.
                </p>
                <TableScroll label="Marketplace offer comparison">
                  <table>
                    <thead>
                      <tr>
                        <th>Unit price</th>
                        <th>Stock</th>
                        <th>Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.data.items.map((row) => (
                        <tr key={row.id}>
                          <td>{unitPrice(row.price, row.currency)}</td>
                          <td>{row.quantity}</td>
                          <td>{row.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </>
            )}
          </section>
        )}
      </div>
      {!create && target && (
        <PricingControls offerId={target} configured={configured} />
      )}
    </div>
  );
}
