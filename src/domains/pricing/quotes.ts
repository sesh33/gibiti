import "server-only";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { eldoradoClient, type EldoradoClient } from "@/domains/eldorado/client";
import {
  comparableOffer,
  comparableContext,
} from "@/domains/offers/comparison";
import { AppError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { moneyInput } from "@/domains/eldorado/contracts";
import type { PricingPolicy, PricingQuote } from "./models";

// This is an application request budget, not a claimed marketplace quota.
const maxPages = 5;
const competitor = comparableOffer.extend({
  userId: z.string(),
  guaranteedDeliveryTime: z.string(),
  volumeDiscounts: z.array(z.json()),
});
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
) {
  const own = await client.predefinedSnapshot(policy.native_id);
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
  const candidates: number[] = [];
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
      if (parsed.data.quantity < parsed.data.minQuantity) continue;
      const row = parsed.data,
        key = row.id.toLowerCase();
      if (seen.has(key))
        throw new AppError(
          "COMPARISON_INCOMPLETE",
          "Repeated marketplace rows make pagination ambiguous. No write is allowed.",
          409,
        );
      seen.add(key);
      if (equivalent(own, row)) candidates.push(row.pricePerUnit.amount);
    }
  }
  if (ambiguous)
    throw new AppError(
      "COMPARISON_AMBIGUOUS",
      "Some active offers have incomplete comparison metadata. No recommendation or write is allowed.",
      409,
    );
  if (!candidates.length)
    throw new AppError(
      "NO_EQUIVALENT_OFFERS",
      "No fully equivalent active competitor was verified. No recommendation or write is allowed.",
      409,
    );
  const minimum = Math.min(...candidates),
    amount = choosePrice(
      minimum,
      Number(policy.floor),
      Number(policy.difference),
      policy.decimals,
    );
  if (!moneyInput.safeParse({ amount, currency: own.currency }).success)
    throw new AppError(
      "QUOTE_SCHEMA_REQUIRED",
      "The computed price or currency is outside the supplied write contract. No write is allowed.",
      409,
    );
  return {
    amount,
    currency: own.currency,
    before: own,
    proof: {
      complete: true,
      pages: totalPages,
      equivalentOffers: candidates.length,
      minimum,
      position:
        amount < minimum
          ? "undercut"
          : amount === minimum
            ? "matched"
            : "floor_limited",
      configuredFloor: Number(policy.floor),
      difference: Number(policy.difference),
      decimals: policy.decimals,
      contextHash: createHash("sha256")
        .update(JSON.stringify(own.context))
        .digest("hex"),
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
export async function validateQuoteBeforeWrite(id: string) {
  const admin = supabaseAdmin();
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
  const fresh = await buildPricingQuote(policy as PricingPolicy);
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
}
