import { z } from "zod";
import { AppError } from "@/lib/errors";

import type { OfferSource } from "./definitions";
const amount = z.object({
  amount: z.number().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
// Explicit fields observed in authorized Seller API list responses. Unknown/private
// fields are stripped and are never persisted or returned to the browser.
export const sellerOfferSchema = z.object({
  id: z.string().min(1).max(150),
  offerTitle: z.string().nullable().optional(),
  category: z.string(),
  gameId: z.string().nullable().optional(),
  offerState: z.string(),
  quantity: z.number().finite().nonnegative().nullable().optional(),
  pricePerUnit: amount.nullable().optional(),
});
export const sellerOfferPageSchema = z.object({
  pageIndex: z.number().int().nonnegative(),
  pageSize: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  results: z.array(sellerOfferSchema),
});
export type SellerOffer = z.infer<typeof sellerOfferSchema>;
export type SellerOfferPage = z.infer<typeof sellerOfferPageSchema>;
export type OfferRecord = {
  id: string;
  native_id: string;
  source: OfferSource;
  category: string;
  title: string;
  state: string;
  price: number | null;
  currency: string | null;
  quantity: number | null;
  game_id: string | null;
  updated_at: string;
};
export function parseSellerOfferPage(data: unknown): SellerOfferPage {
  const parsed = sellerOfferPageSchema.safeParse(data);
  if (!parsed.success)
    throw new AppError(
      "OFFERS_CONTRACT_MISMATCH",
      "The offer response does not match the verified read contract. No records were stored.",
      502,
    );
  return parsed.data;
}
export function normalizeOffer(
  offer: SellerOffer,
  source: OfferSource,
  syncedAt = new Date().toISOString(),
): OfferRecord {
  return {
    id: source + ":" + offer.id,
    native_id: offer.id,
    source,
    category: offer.category,
    title:
      offer.offerTitle?.trim() ||
      `Listing ${offer.id.slice(0, 8).toUpperCase()}`,
    state: offer.offerState,
    price: offer.pricePerUnit?.amount ?? null,
    currency: offer.pricePerUnit?.currency ?? null,
    quantity: offer.quantity ?? null,
    game_id: offer.gameId ?? null,
    updated_at: syncedAt,
  };
}
