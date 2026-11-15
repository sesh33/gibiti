import "server-only";
import { z } from "zod";
import { eldoradoClient } from "@/domains/eldorado/client";
import {
  currencies,
  deliveryTimes,
  predefinedInput,
  requiredChangePermissions,
  type MarketplaceChange,
} from "@/domains/eldorado/contracts";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import type { requireStaff } from "@/domains/authentication/session";
import { checkEconomics } from "@/domains/pricing/economics";
const choice = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("price"),
      amount: z.number().finite().positive(),
      currency: z.enum(currencies),
    })
    .strict(),
  z
    .object({
      kind: z.literal("quantity"),
      quantity: z.number().int().min(0).max(2147483647),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delivery"),
      deliveryTime: z.enum(deliveryTimes),
    })
    .strict(),
]);
export const batchInput = z
  .object({
    offerIds: z
      .array(z.string().regex(/^predefined:[0-9a-f-]{36}$/i))
      .min(1)
      .max(10)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
        "Duplicate listing",
      ),
    change: choice,
  })
  .strict();
type Staff = Awaited<ReturnType<typeof requireStaff>>;
export async function buildBatchPreview(
  raw: unknown,
  staff: Staff,
  client = eldoradoClient(),
) {
  const input = batchInput.parse(raw),
    kind =
      input.change.kind === "price"
        ? "offer.price"
        : input.change.kind === "quantity"
          ? "offer.quantity"
          : "offer.details";
  if (
    !staff.permissions.has("offers.read") ||
    !requiredChangePermissions(kind).every((p) => staff.permissions.has(p))
  )
    throw new AppError(
      "FORBIDDEN",
      "Your account cannot request this batch action.",
      403,
    );
  const { data: records, error } = await staff.db
    .from("offers")
    .select("id,native_id,title,currency,updated_at")
    .in("id", input.offerIds);
  if (error || !records || records.length !== input.offerIds.length)
    throw new AppError(
      "BATCH_TARGET_UNAVAILABLE",
      "Synchronize every selected predefined listing before previewing.",
      409,
    );
  const { data: policies, error: policyError } = await supabaseAdmin()
    .from("repricing_policies")
    .select("native_id,floor,currency,economics")
    .in(
      "native_id",
      records.map((record) => record.native_id),
    );
  if (policyError)
    throw new AppError(
      "FLOOR_STORE_UNAVAILABLE",
      "Saved price floors could not be checked.",
      503,
    );
  const results = await Promise.allSettled(
    records.map(async (record) => {
      const before = await client.predefinedSnapshot(record.native_id);
      if (!["Active", "Paused"].includes(before.state))
        throw new AppError(
          "BATCH_INELIGIBLE_STATE",
          "Only Active or Paused listings are eligible.",
          409,
        );
      let change: MarketplaceChange;
      if (input.change.kind === "price") {
        if (before.currency !== input.change.currency)
          throw new AppError(
            "BATCH_CURRENCY_MISMATCH",
            "This listing uses another currency.",
            409,
          );
        change = {
          kind: "offer.price",
          body: {
            amount: input.change.amount,
            currency: input.change.currency,
          },
        };
      } else if (input.change.kind === "quantity")
        change = { kind: "offer.quantity", body: input.change.quantity };
      else {
        if (!before.document)
          throw new AppError(
            "BATCH_DETAILS_INCOMPLETE",
            "The full product attributes cannot be preserved safely; edit this listing individually.",
            409,
          );
        change = {
          kind: "offer.details",
          body: predefinedInput.parse({
            ...before.document,
            details: {
              ...before.document.details,
              guaranteedDeliveryTime: input.change.deliveryTime,
            },
          }),
        };
      }
      const floor = policies?.find(
        (policy) =>
          policy.native_id.toLowerCase() === record.native_id.toLowerCase(),
      );
      const money =
        change.kind === "offer.price"
          ? change.body
          : change.kind === "offer.details"
            ? change.body.details.pricing.pricePerUnit
            : null;
      let effectiveFloor = floor ? Number(floor.floor) : null;
      if (floor && money && floor.economics != null) {
        const economics = checkEconomics(floor.economics);
        if (!economics.ok)
          throw new AppError(
            "BATCH_ECONOMICS_UNVERIFIED",
            economics.reason,
            409,
          );
        effectiveFloor = Math.max(Number(floor.floor), economics.economicFloor);
      }
      if (
        floor &&
        money &&
        (money.currency !== floor.currency ||
          money.amount < (effectiveFloor ?? 0))
      )
        throw new AppError(
          "BATCH_FLOOR_VIOLATION",
          "The requested change violates this listing's saved price floor, current economic floor or currency.",
          409,
        );
      return {
        target: record.id,
        title: record.title,
        expectedSnapshot: record.updated_at,
        before,
        change,
        floor: effectiveFloor,
      };
    }),
  );
  const problems = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            offerId: records[index].id,
            title: records[index].title,
            code:
              result.reason instanceof AppError
                ? result.reason.code
                : "BATCH_READ_FAILED",
            message:
              result.reason instanceof AppError
                ? result.reason.message
                : "The current listing could not be verified.",
          },
        ]
      : [],
  );
  if (problems.length) return { valid: false as const, items: [], problems };
  const items = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const { data: preview, error: saveError } = await supabaseAdmin()
    .from("offer_batch_previews")
    .insert({ created_by: staff.user.id, items })
    .select("id,expires_at")
    .single();
  if (saveError || !preview)
    throw new AppError(
      "BATCH_PREVIEW_NOT_SAVED",
      "No changes were sent. The preview could not be saved.",
      503,
    );
  return {
    valid: true as const,
    id: preview.id,
    expiresAt: preview.expires_at,
    items,
    problems: [],
  };
}
