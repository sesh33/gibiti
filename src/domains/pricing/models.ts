import { z } from "zod";
import { currencies } from "@/domains/eldorado/contracts";
export const policyInput = z
  .object({
    offerId: z.string().regex(/^predefined:[0-9a-f-]{36}$/i),
    floor: z.number().finite().positive(),
    difference: z.number().finite().nonnegative(),
    decimals: z.number().int().min(0).max(8),
    mode: z.enum(["simulation", "manual", "automatic"]).default("simulation"),
    intervalSeconds: z.number().int().min(15).max(86400).default(15),
    confirmAutomatic: z.boolean().default(false),
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
