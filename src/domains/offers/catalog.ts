import { z } from "zod";
import { deliveryTimes } from "@/domains/eldorado/contracts";

// These are operator labels for organizing this workspace. They are never sent
// to Eldorado and never establish product equivalence for repricing.
export const catalogTagsInput = z
  .object({
    offerId: z.string().min(1).max(200),
    region: z.string().trim().max(100),
    platform: z.string().trim().max(100),
    denomination: z.string().trim().max(100),
  })
  .strict();

export const catalogQuery = z.object({
  source: z
    .enum(["all", "flexible", "predefined", "items", "currency"])
    .default("all"),
  search: z.string().trim().max(100).default(""),
  state: z.string().max(100).default(""),
  category: z.string().max(100).default(""),
  game: z.string().max(150).default(""),
  region: z.string().max(100).default(""),
  platform: z.string().max(100).default(""),
  denomination: z.string().max(100).default(""),
  delivery: z.union([z.literal(""), z.enum(deliveryTimes)]).default(""),
  stock: z.enum(["", "positive", "empty", "unknown"]).default(""),
  freshness: z.enum(["", "recent", "stale"]).default(""),
  cursor: z.string().max(600).optional(),
});

export const CATALOG_FRESHNESS_MS = 15 * 60 * 1000;

export function catalogReadIsRecent(updatedAt: string, now = Date.now()) {
  const age = now - Date.parse(updatedAt);
  return Number.isFinite(age) && age >= 0 && age <= CATALOG_FRESHNESS_MS;
}

export function catalogStockLabel(offer: {
  quantity: number | null;
  min_quantity?: number | null;
}) {
  if (offer.quantity === null) return "Stock unknown";
  if (offer.quantity <= 0) return "Out of stock";
  if (offer.min_quantity != null && offer.quantity < offer.min_quantity)
    return "Below minimum order";
  if (offer.min_quantity == null) return "Stock shown · minimum unknown";
  return "Stock meets minimum";
}

export function escapeLikeSearch(value: string) {
  // Used in a single .ilike column filter, never interpolated into .or grammar.
  // Retain Unicode and treat SQL LIKE metacharacters as literal user input.
  return value.replace(/[\\%_]/g, "\\$&");
}

export type PublicContextEntry = {
  id?: string;
  attributeId?: string;
  name?: string;
  value?: string;
  values?: string[];
};
export type PublicOfferContext = {
  attributes: PublicContextEntry[];
  tradeEnvironmentValues: PublicContextEntry[];
  offerAttributeIdValues: PublicContextEntry[];
};

export function selectPublicContextEntries(
  input: unknown[],
): PublicContextEntry[] {
  return input.slice(0, 100).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry: PublicContextEntry = {};
    const record = raw as Record<string, unknown>;
    for (const key of ["id", "attributeId", "name", "value"] as const)
      if (typeof record[key] === "string")
        entry[key] = record[key].slice(0, 256);
    if (Array.isArray(record.values))
      entry.values = record.values
        .filter((value): value is string => typeof value === "string")
        .slice(0, 100)
        .map((value) => value.slice(0, 256));
    return Object.keys(entry).length ? [entry] : [];
  });
}
