import "server-only";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { eldoradoClient, type EldoradoClient } from "@/domains/eldorado/client";
import {
  comparableOffer,
  comparableContext,
  hasUnverifiedDiscount,
} from "@/domains/offers/comparison";
import { AppError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { moneyInput } from "@/domains/eldorado/contracts";
import {
  economicsInput,
  type PricingPolicy,
  type PricingQuote,
} from "./models";
import {
  checkEconomics,
  clockToleranceMs,
  estimateEconomics,
} from "./economics";

// This is an application request budget, not a claimed marketplace quota.
const maxPages = 5;
export const maxMarketAgeMs = 60_000;
const competitor = comparableOffer.extend({
  userId: z.string(),
  guaranteedDeliveryTime: z.string(),
  volumeDiscounts: z.array(z.json()),
});
export function pricingContextHash(
  own: Pick<
    Awaited<ReturnType<EldoradoClient["predefinedSnapshot"]>>,
    "gameId" | "category" | "currency" | "context" | "details"
  >,
) {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    return value;
  }
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          gameId: own.gameId,
          category: own.category,
          currency: own.currency,
          context: own.context,
          delivery: own.details?.guaranteedDeliveryTime,
          volumeDiscounts: own.details?.pricing.volumeDiscounts,
        }),
      ),
    )
    .digest("hex");
}
function equivalent(
  own: Awaited<ReturnType<EldoradoClient["predefinedSnapshot"]>>,
  candidate: z.infer<typeof competitor>,
) {
  return (
    candidate.gameId === own.gameId &&
    candidate.category === own.category &&
    candidate.pricePerUnit.currency === own.currency &&
    isDeepStrictEqual(comparableContext(candidate), own.context) &&
    candidate.guaranteedDeliveryTime === own.details?.guaranteedDeliveryTime &&
    isDeepStrictEqual(
      candidate.volumeDiscounts,
      own.details?.pricing.volumeDiscounts,
    )
  );
}
export function choosePrice(
  minimum: number,
  floor: number,
  difference: number,
  decimals: number,
) {
  const scale = 10 ** decimals;
  // Round up, never down across a configured floor. Reject values whose
  // requested precision cannot be represented safely in JavaScript.
  const raw = Math.max(floor, minimum - difference),
    scaled = raw * scale;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER)
    throw new AppError(
      "PRICE_PRECISION_UNSAFE",
      "Use a price and precision that can be represented safely.",
      409,
    );
  const amount =
    Math.ceil(scaled - Number.EPSILON * Math.max(1, Math.abs(scaled))) / scale;
  const safe = amount < floor ? Math.ceil(floor * scale) / scale : amount;
  if (!Number.isFinite(safe) || safe < floor || safe <= 0)
    throw new AppError(
      "PRICE_FLOOR_BLOCKED",
      "The computed price did not satisfy the configured floor.",
      409,
    );
  return safe;
}
export async function buildPricingQuote(
  policy: PricingPolicy,
  client = eldoradoClient(),
  now: () => number = Date.now,
) {
  const collectionStarted = now();
  const own = await client.predefinedSnapshot(policy.native_id);
  if (own.category === "TopUp")
    throw new AppError(
      "TOPUP_COMPARISON_UNVERIFIED",
      "Top-up repricing is blocked until authoritative region, platform and denomination mappings are verified. Local catalog tags do not authorize matching; edit the offer manually with review.",
      409,
    );
  if (
    !own.contextComplete ||
    !own.sellerId ||
    !own.details ||
    own.currency !== policy.currency ||
    own.state !== "Active" ||
    own.quantity <= 0 ||
    own.quantity < own.details.pricing.minQuantity
  )
    throw new AppError(
      "COMPARISON_BLOCKED",
      "The own listing must be active, in stock and have complete package, currency and delivery metadata.",
      409,
    );
  if (
    own.discount?.unverified ||
    hasUnverifiedDiscount({
      pricePerUnit: { amount: own.price, currency: own.currency },
      ...own.discount,
    })
  )
    throw new AppError(
      "DISCOUNT_REVIEW_REQUIRED",
      "The listing has discounted or unverified pricing. Review the discount manually; its funding and effect on seller proceeds cannot be assumed. No repricing is allowed.",
      409,
    );
  const economics = checkEconomics(policy.economics, now()),
    savedEconomics = economicsInput.safeParse(policy.economics),
    comparisonQuantity = savedEconomics.success
      ? savedEconomics.data.comparisonQuantity
      : own.details.pricing.minQuantity;
  if (
    comparisonQuantity < own.details.pricing.minQuantity ||
    own.quantity < comparisonQuantity
  )
    throw new AppError(
      "COMPARISON_QUANTITY_UNAVAILABLE",
      "The comparison quantity must meet the listing minimum and be available in stock.",
      409,
    );
  const candidates: { id: string; amount: number }[] = [];
  let totalPages = 1,
    ambiguous = 0;
  const seen = new Set<string>();
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    const page = await client.read(
      "/api/predefinedOffers/game",
      (data) =>
        z
          .object({
            pageIndex: z.number().int(),
            totalPages: z.number().int().nonnegative(),
            results: z.array(z.object({ offer: z.unknown() })),
          })
          .parse(data),
      {
        gameId: own.gameId,
        category: own.category,
        pageIndex: String(pageIndex),
        pageSize: "50",
      },
    );
    totalPages = Math.max(1, page.totalPages);
    if (totalPages > maxPages || page.pageIndex !== pageIndex)
      throw new AppError(
        "COMPARISON_INCOMPLETE",
        "The complete market cannot be checked within this read budget. No recommendation or write is allowed.",
        409,
      );
    for (const group of page.results) {
      const preliminary = z
        .object({
          id: z.guid().optional(),
          userId: z.string().optional(),
          offerState: z.string().optional(),
          quantity: z.number().optional(),
        })
        .safeParse(group.offer);
      if (
        preliminary.success &&
        (preliminary.data.id?.toLowerCase() === own.id.toLowerCase() ||
          preliminary.data.userId === own.sellerId)
      )
        continue;
      if (
        preliminary.success &&
        ((preliminary.data.offerState &&
          preliminary.data.offerState !== "Active") ||
          (typeof preliminary.data.quantity === "number" &&
            preliminary.data.quantity <= 0))
      )
        continue;
      const parsed = competitor.safeParse(group.offer);
      if (!parsed.success) {
        ambiguous++;
        continue;
      }
      if (
        parsed.data.quantity < parsed.data.minQuantity ||
        parsed.data.quantity < comparisonQuantity
      )
        continue;
      const row = parsed.data,
        key = row.id.toLowerCase();
      if (seen.has(key))
        throw new AppError(
          "COMPARISON_INCOMPLETE",
          "Repeated marketplace rows make pagination ambiguous. No write is allowed.",
          409,
        );
      seen.add(key);
      if (equivalent(own, row)) {
        if (hasUnverifiedDiscount(row)) ambiguous++;
        else candidates.push({ id: row.id, amount: row.pricePerUnit.amount });
      }
    }
  }
  if (ambiguous)
    throw new AppError(
      "COMPARISON_AMBIGUOUS",
      "Some active offers have incomplete comparison metadata or unverified discounted pricing. Review discounts manually; no recommendation or write is allowed.",
      409,
    );
  if (!candidates.length)
    throw new AppError(
      "NO_EQUIVALENT_OFFERS",
      "No fully equivalent active competitor was verified. No recommendation or write is allowed.",
      409,
    );
  const observed = now();
  if (
    observed - collectionStarted >= maxMarketAgeMs ||
    collectionStarted > observed
  )
    throw new AppError(
      "COMPARISON_STALE",
      "The market read exceeded its freshness window. Check the market again; no write is allowed.",
      409,
    );
  const effectiveFloor = Math.max(
      Number(policy.floor),
      economics.ok ? economics.economicFloor : 0,
    ),
    minimum = Math.min(...candidates.map((candidate) => candidate.amount)),
    amount = choosePrice(
      minimum,
      effectiveFloor,
      Number(policy.difference),
      policy.decimals,
    );
  if (!moneyInput.safeParse({ amount, currency: own.currency }).success)
    throw new AppError(
      "QUOTE_SCHEMA_REQUIRED",
      "The computed price or currency is outside the supplied write contract. No write is allowed.",
      409,
    );
  const estimate = economics.ok
      ? estimateEconomics(economics.basis, amount)
      : null,
    currentEconomics = checkEconomics(policy.economics, observed);
  let blockedReason: string | null = !currentEconomics.ok
    ? currentEconomics.reason
    : null;
  if (
    policy.economics &&
    policy.economics_context_hash !== pricingContextHash(own)
  )
    blockedReason =
      "The product, package or delivery context changed since cost verification. The Owner must verify costs and save this policy again.";
  if (own.details.pricing.volumeDiscounts.length)
    blockedReason =
      "Volume discounts need a tier-specific margin review. This simulation cannot authorize repricing.";
  if (
    economics.ok &&
    economics.basis.fixedFee > 0 &&
    comparisonQuantity !== own.details.pricing.minQuantity
  )
    blockedReason =
      "A fixed basket fee must be estimated at the listing's minimum purchase quantity to protect smaller orders. Set the comparison quantity to that minimum.";
  if (
    estimate &&
    (!Object.values(estimate)
      .filter((value) => typeof value === "number")
      .every(Number.isFinite) ||
      estimate.marginPercent + 1e-9 < estimate.basis.minMarginPercent)
  )
    blockedReason =
      "The estimated margin could not be proven above the saved minimum.";
  const validUntil = Math.min(
    collectionStarted + maxMarketAgeMs,
    economics.ok ? Date.parse(economics.basis.validUntil) : Infinity,
  );
  return {
    amount,
    currency: own.currency,
    before: own,
    proof: {
      complete: true,
      pages: totalPages,
      equivalentOffers: candidates.length,
      observedOffers: candidates,
      minimum,
      position:
        amount < minimum
          ? "undercut"
          : amount === minimum
            ? "matched"
            : "floor_limited",
      configuredFloor: Number(policy.floor),
      effectiveFloor,
      executable: blockedReason === null,
      blockedReason,
      comparisonQuantity,
      collectionStartedAt: new Date(collectionStarted).toISOString(),
      observedAt: new Date(observed).toISOString(),
      validUntil: new Date(validUntil).toISOString(),
      economics: estimate,
      difference: Number(policy.difference),
      decimals: policy.decimals,
      contextHash: pricingContextHash(own),
      policyVersion: policy.version,
    },
  };
}
export async function persistQuote(
  policy: PricingPolicy,
  actor: string,
  result: Awaited<ReturnType<typeof buildPricingQuote>>,
): Promise<PricingQuote> {
  const { data, error } = await supabaseAdmin()
    .from("repricing_quotes")
    .insert({
      policy_id: policy.id,
      policy_version: policy.version,
      requested_by: actor,
      amount: result.amount,
      currency: result.currency,
      before_snapshot: result.before,
      proof: result.proof,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError(
      "QUOTE_SAVE_FAILED",
      "The simulation could not be recorded. No write was sent.",
      503,
    );
  return data as PricingQuote;
}
export function pricingFreshnessGuard(
  proof: Record<string, unknown>,
  quoteExpiresAt: string,
  now: () => number = Date.now,
) {
  return () => {
    const clock = now(),
      started = Date.parse(String(proof.collectionStartedAt)),
      observed = Date.parse(String(proof.observedAt)),
      expiry = Date.parse(String(proof.validUntil)),
      quoteExpiry = Date.parse(quoteExpiresAt);
    if (!Number.isFinite(quoteExpiry) || quoteExpiry <= clock)
      throw new AppError(
        "QUOTE_EXPIRED",
        "The approved quote expired. Simulate and review a new request.",
        409,
      );
    if (
      ![clock, started, observed, expiry].every(Number.isFinite) ||
      started > clock + clockToleranceMs ||
      observed > clock + clockToleranceMs ||
      observed < started ||
      observed - started > maxMarketAgeMs ||
      clock - started >= maxMarketAgeMs ||
      expiry > started + maxMarketAgeMs ||
      expiry <= clock
    )
      throw new AppError(
        "COMPARISON_STALE",
        "The verified market data expired before sending. No price change is allowed.",
        409,
      );
    if (proof.executable !== true)
      throw new AppError(
        "ECONOMICS_BLOCKED",
        typeof proof.blockedReason === "string"
          ? proof.blockedReason
          : "Complete, current cost and fee estimates are required before execution.",
        409,
      );
  };
}

export async function validateQuoteBeforeWrite(
  id: string,
  dependencies: {
    admin?: ReturnType<typeof supabaseAdmin>;
    client?: EldoradoClient;
    now?: () => number;
  } = {},
) {
  const admin = dependencies.admin ?? supabaseAdmin(),
    now = dependencies.now ?? Date.now;
  const { data: quote, error } = await admin
    .from("repricing_quotes")
    .select("*")
    .eq("id", z.uuid().parse(id))
    .single();
  if (error || !quote)
    throw new AppError(
      "QUOTE_NOT_FOUND",
      "The approved price simulation could not be loaded.",
      409,
    );
  // The approved lifecycle has a strict expiry even if a later market happens
  // to return the same amount. Refreshing never extends human authority.
  if (
    !Number.isFinite(Date.parse(quote.expires_at)) ||
    Date.parse(quote.expires_at) <= now()
  )
    throw new AppError(
      "QUOTE_EXPIRED",
      "The approved quote expired. Simulate and review a new request.",
      409,
    );
  if (quote.proof?.executable !== true)
    throw new AppError(
      "ECONOMICS_BLOCKED",
      "The approved simulation did not authorize repricing. Verify cost and fee estimates, then simulate again.",
      409,
    );
  const { data: policy } = await admin
    .from("repricing_policies")
    .select("*")
    .eq("id", quote.policy_id)
    .single();
  if (!policy || policy.version !== quote.policy_version)
    throw new AppError(
      "QUOTE_CHANGED",
      "The pricing policy changed. Simulate and review a new request.",
      409,
    );
  const fresh = await buildPricingQuote(
    policy as PricingPolicy,
    dependencies.client ?? eldoradoClient(),
    now,
  );
  const assertFresh = pricingFreshnessGuard(fresh.proof, quote.expires_at, now);
  assertFresh();
  if (
    fresh.amount !== Number(quote.amount) ||
    fresh.currency !== quote.currency ||
    !isDeepStrictEqual(fresh.before, quote.before_snapshot)
  )
    throw new AppError(
      "QUOTE_CHANGED",
      "The listing or market changed. Simulate and review a new request.",
      409,
    );
  return { assertFresh, proof: fresh.proof };
}
