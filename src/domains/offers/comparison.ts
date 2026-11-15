import "server-only";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { eldoradoClient } from "@/domains/eldorado/client";
const money = z.object({
  amount: z.number().finite().positive(),
  currency: z.string(),
});
export const comparableOffer = z.object({
  id: z.guid(),
  userId: z.string().nullish(),
  gameId: z.string(),
  category: z.string(),
  offerState: z.string(),
  quantity: z.number().finite(),
  minQuantity: z.number(),
  pricePerUnit: money,
  // Keep optional upstream discount fields even when malformed, so they cannot
  // be silently stripped and mistaken for a verified base-price comparison.
  pricePerUnitWithDiscount: z.unknown().optional(),
  discountPercentage: z.unknown().optional(),
  unitSystem: z.string(),
  deliveryMethod: z.string(),
  attributes: z.array(z.json()),
  tradeEnvironmentValues: z.array(z.json()),
  offerAttributeIdValues: z.array(z.json()),
});
export function hasUnverifiedDiscount(offer: {
  pricePerUnit: { amount: number; currency: string };
  pricePerUnitWithDiscount?: unknown;
  discountPercentage?: unknown;
}) {
  if (
    offer.discountPercentage !== undefined &&
    offer.discountPercentage !== null
  ) {
    const percentage = z.number().finite().safeParse(offer.discountPercentage);
    if (!percentage.success || percentage.data !== 0) return true;
  }
  if (
    offer.pricePerUnitWithDiscount !== undefined &&
    offer.pricePerUnitWithDiscount !== null
  ) {
    const discounted = money.safeParse(offer.pricePerUnitWithDiscount);
    if (
      !discounted.success ||
      discounted.data.amount !== offer.pricePerUnit.amount ||
      discounted.data.currency !== offer.pricePerUnit.currency
    )
      return true;
  }
  return false;
}
export function comparableContext(offer: z.infer<typeof comparableOffer>) {
  return {
    minQuantity: offer.minQuantity,
    unitSystem: offer.unitSystem,
    deliveryMethod: offer.deliveryMethod,
    attributes: offer.attributes,
    tradeEnvironmentValues: offer.tradeEnvironmentValues,
    offerAttributeIdValues: offer.offerAttributeIdValues,
  };
}
export async function comparePredefinedOffers(id: string, pageIndex = 1) {
  const client = eldoradoClient(),
    own = await client.predefinedSnapshot(id);
  if (own.category === "TopUp")
    return {
      items: [],
      complete: false,
      message:
        "Top-up comparisons require an authoritative mapping for region, platform and denomination. Local catalog labels do not prove equivalence. Edit the listing manually while this mapping is unavailable.",
    };
  const sellerId = own.sellerId;
  if (!sellerId)
    return {
      items: [],
      complete: false,
      message:
        "The listing seller could not be verified, so your own listings cannot be excluded reliably. Comparison is blocked.",
    };
  if (!own.contextComplete)
    return {
      items: [],
      complete: false,
      message:
        "The listing's package, attributes or unit could not be identified. Comparison is blocked.",
    };
  if (
    own.discount?.unverified ||
    hasUnverifiedDiscount({
      pricePerUnit: { amount: own.price, currency: own.currency },
      ...own.discount,
    })
  )
    return {
      items: [],
      complete: false,
      message:
        "The listing has discounted or unverified pricing. Review the discount manually before comparing base prices; its effect on seller proceeds is not assumed.",
    };
  const raw = await client.read(
    "/api/predefinedOffers/game",
    (value) =>
      z
        .object({
          results: z.array(z.object({ offer: z.unknown() })),
          pageIndex: z.number().int(),
          totalPages: z.number().int(),
        })
        .parse(value),
    {
      gameId: own.gameId,
      category: own.category,
      pageIndex: String(pageIndex),
      pageSize: "50",
    },
  );
  const items = raw.results
    .flatMap((row) => {
      const parsed = comparableOffer.safeParse(row.offer);
      if (!parsed.success) return [];
      const offer = parsed.data;
      if (
        offer.id.toLowerCase() === own.id.toLowerCase() ||
        !offer.userId ||
        offer.userId.toLowerCase() === sellerId.toLowerCase() ||
        offer.offerState !== "Active" ||
        offer.quantity <= 0 ||
        offer.quantity < offer.minQuantity ||
        offer.gameId !== own.gameId ||
        offer.category !== own.category ||
        offer.pricePerUnit.currency !== own.currency ||
        hasUnverifiedDiscount(offer) ||
        !isDeepStrictEqual(comparableContext(offer), own.context)
      )
        return [];
      return [
        {
          id: offer.id,
          price: offer.pricePerUnit.amount,
          currency: offer.pricePerUnit.currency,
          quantity: offer.quantity,
          minQuantity: offer.minQuantity,
          unit: offer.unitSystem,
          deliveryMethod: offer.deliveryMethod,
        },
      ];
    })
    .sort((a, b) => a.price - b.price);
  return {
    items,
    page: raw.pageIndex,
    totalPages: raw.totalPages,
    complete: raw.totalPages <= 1,
    message:
      "Only exact game, category, package, environment, unit, delivery method and currency matches are shown. This page is informational; no automatic repricing or market-wide lowest-price claim.",
  };
}
