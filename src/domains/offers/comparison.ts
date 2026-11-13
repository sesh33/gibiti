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
  gameId: z.string(),
  category: z.string(),
  offerState: z.string(),
  quantity: z.number().finite(),
  minQuantity: z.number(),
  pricePerUnit: money,
  unitSystem: z.string(),
  deliveryMethod: z.string(),
  attributes: z.array(z.json()),
  tradeEnvironmentValues: z.array(z.json()),
  offerAttributeIdValues: z.array(z.json()),
});
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
  if (!own.contextComplete)
    return {
      items: [],
      complete: false,
      message:
        "The listing's package, attributes or unit could not be identified. Comparison is blocked.",
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
        offer.id === own.id ||
        offer.offerState !== "Active" ||
        offer.quantity <= 0 ||
        offer.gameId !== own.gameId ||
        offer.category !== own.category ||
        offer.pricePerUnit.currency !== own.currency ||
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
