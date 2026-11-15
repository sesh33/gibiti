import { z } from "zod";
import { currencies } from "@/domains/eldorado/contracts";
export const economicsInput = z
  .object({
    unitCost: z.number().finite().min(0).max(1e12),
    feePercent: z.number().finite().min(0).max(99.99),
    fixedFee: z.number().finite().min(0).max(1e12),
    comparisonQuantity: z.number().int().min(1).max(2147483647),
    minMarginPercent: z.number().finite().min(0).max(99.99),
    verifiedAt: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (input) => input.feePercent + input.minMarginPercent < 100,
    "Fees and minimum margin must leave a positive contribution to costs.",
  )
  .refine(
    (input) => Date.parse(input.validUntil) > Date.parse(input.verifiedAt),
    "The estimate must expire after its verification time.",
  )
  .refine(
    (input) =>
      Date.parse(input.validUntil) - Date.parse(input.verifiedAt) <=
      30 * 86400_000,
    "Cost and fee verification is valid for at most 30 days.",
  );
export type PricingEconomics = z.infer<typeof economicsInput>;
export const policyInput = z
  .object({
    offerId: z.string().regex(/^predefined:[0-9a-f-]{36}$/i),
    floor: z.number().finite().positive(),
    difference: z.number().finite().nonnegative(),
    decimals: z.number().int().min(0).max(8),
    mode: z.enum(["simulation", "manual", "automatic"]).default("simulation"),
    intervalSeconds: z.number().int().min(15).max(86400).default(15),
    confirmAutomatic: z.boolean().default(false),
    economics: economicsInput.nullable().default(null),
  })
  .strict()
  .refine(
    (input) =>
      input.difference === 0 ||
      input.difference * 10 ** input.decimals >= 1 - 1e-10,
    "The decimal precision must represent the configured difference.",
  );
export type PricingPolicy = {
  id: string;
  offer_id: string;
  native_id: string;
  currency: (typeof currencies)[number];
  floor: number;
  difference: number;
  decimals: number;
  mode: "simulation" | "manual" | "automatic";
  interval_seconds: number;
  version: string;
  created_by: string;
  approved_by: string | null;
  review_status: string;
  last_checked_at: string | null;
  last_error_code: string | null;
  next_run_at: string;
  economics?: PricingEconomics | null;
  economics_context_hash?: string | null;
};
export type PricingQuote = {
  id: string;
  policy_id: string;
  policy_version: string;
  requested_by: string;
  amount: number;
  currency: string;
  before_snapshot: Record<string, unknown>;
  proof: Record<string, unknown>;
  created_at: string;
  expires_at: string;
};
export const workspacePreferenceInput = z
  .object({
    pollEnabled: z.boolean(),
    pollSeconds: z.number().int().min(60).max(86400),
    autoDeliveryEnabled: z.boolean(),
    autoPricingEnabled: z.boolean(),
    confirmAutomation: z.boolean().default(false),
  })
  .strict();
export const staffPreferenceInput = z
  .object({
    orderPollingEnabled: z.boolean(),
    orderPollingSeconds: z.number().int().min(30).max(86400),
  })
  .strict();
