import { z } from "zod";
export const currencies = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "JPY",
  "BRL",
  "SGD",
  "CHF",
  "SEK",
  "DKK",
  "NOK",
  "NZD",
  "THB",
  "HKD",
  "CZK",
  "SAR",
  "PLN",
  "AED",
  "MXN",
  "RON",
  "ILS",
  "ARS",
  "TRY",
  "QAR",
  "HUF",
  "PEN",
  "KWD",
  "BGN",
  "CLP",
  "COP",
  "IDR",
  "PHP",
] as const;
export const deliveryTimes = [
  "Minute5",
  "Minute20",
  "Hour1",
  "Hour2",
  "Hour3",
  "Hour5",
  "Hour8",
  "Hour12",
  "Day1",
  "Day2",
  "Day3",
  "Day5",
  "Day7",
  "Day10",
  "Day14",
  "Day28",
  "Day45",
  "Day60",
  "Day80",
  "Day100",
  "Instant",
  "Automated",
  "NotApplicable",
] as const;
export const cancelReasons = [
  "Mutual_Agreement",
  "Boost_Couldnt_Be_Completed_Due_To_Account_Issues",
  "Buyer_Provided_Incorrect_Account_Information",
  "Poor_Boosting_Quality",
  "Failed_To_Meet_Timeline",
  "Out_Of_Stock",
  "Buyer_Does_Not_Meet_Criteria_For_Order",
  "Buyer_Does_Not_Need_It_Anymore",
  "Account_Listed_Incorrectly",
  "Access_To_Account_Lost",
  "Buyer_Asked_For_A_Refund_Due_To_Dissatisfaction",
  "Buyer_Did_Not_Respond",
  "Cancelation_Of_Reserved_Order",
  "Seller_Going_Offline",
  "No_Sellers_Available",
  "Other",
] as const;
export const extensionTimes = [
  "None",
  "Minute5",
  "Minute15",
  "Minute30",
  "Hour1",
  "Hour3",
  "Hour6",
] as const;
export const extensionReasons = [
  "None",
  "WaitingForBuyer",
  "InGameCoordination",
  "PreparationDelay",
  "TechnicalIssue",
] as const;
export const moneyInput = z
  .object({
    amount: z.number().finite().positive(),
    currency: z.enum(currencies),
  })
  .strict();
// Nested game attribute schemas were not supplied. They are public catalog
// metadata, forwarded as JSON; gift-card secrets are deliberately not accepted.
export const predefinedInput = z
  .object({
    details: z
      .object({
        description: z.string().max(30000),
        guaranteedDeliveryTime: z.enum(deliveryTimes),
        pricing: z
          .object({
            quantity: z.number().finite().nonnegative(),
            minQuantity: z.number().finite().positive(),
            volumeDiscounts: z.array(
              z
                .object({
                  quantity: z.number().finite().positive(),
                  percentage: z.number().finite().nonnegative(),
                })
                .strict(),
            ),
            pricePerUnit: moneyInput,
          })
          .strict(),
        deliveryMethod: z.enum([
          "Unspecified",
          "EpicGifting",
          "IslandDelivery",
          "GamePass",
          "MailTrade",
          "AuctionHouse",
          "InGameTrade",
          "RedeemCode",
          "AutoClaim",
          "LoginMethod",
          "Donation",
        ]),
      })
      .strict(),
    augmentedGame: z
      .object({
        gameId: z.string().min(1).max(150),
        category: z.enum([
          "Account",
          "CustomItem",
          "Currency",
          "Boosting",
          "RequestedBoosting",
          "ManagedBoosting",
          "TopUp",
          "GiftCard",
        ]),
        tradeEnvironmentId: z.string().nullable(),
        offerAttributes: z.array(z.json()),
      })
      .strict(),
    giftCardDetails: z.union([z.null(), z.array(z.never()).max(0)]),
  })
  .strict();
export const marketplaceChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer.price"), body: moneyInput }).strict(),
  z
    .object({
      kind: z.literal("offer.quantity"),
      body: z.number().int().min(0).max(2147483647),
    })
    .strict(),
  z
    .object({ kind: z.literal("offer.details"), body: predefinedInput })
    .strict(),
  z.object({ kind: z.literal("offer.create"), body: predefinedInput }).strict(),
  z.object({ kind: z.literal("order.deliver") }).strict(),
  z
    .object({
      kind: z.literal("order.cancel"),
      body: z
        .object({
          reason: z.enum(cancelReasons),
          message: z.string().max(2000).nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("order.extend"),
      body: z
        .object({
          time: z.enum(extensionTimes),
          reason: z.enum(extensionReasons),
          message: z.string().max(2000).nullable(),
        })
        .strict(),
    })
    .strict(),
]);
export type MarketplaceChange = z.infer<typeof marketplaceChange>;
export const changePermissions = {
  "offer.price": "offers.update_price",
  "offer.quantity": "offers.update_stock",
  "offer.details": "offers.create",
  "offer.create": "offers.create",
  "order.deliver": "orders.deliver",
  "order.cancel": "orders.cancel",
  "order.extend": "orders.update_delivery",
} as const;
export function requiredChangePermissions(kind: MarketplaceChange["kind"]) {
  return kind === "offer.details"
    ? (["offers.create", "offers.update_price", "offers.update_stock"] as const)
    : ([changePermissions[kind]] as const);
}
export const operationInput = z
  .object({
    target: z.string().min(1).max(150),
    expectedSnapshot: z.iso.datetime({ offset: true }).nullable(),
    reason: z.string().trim().min(10).max(2000),
    idempotencyKey: z.uuid(),
    confirm: z.literal(true),
    change: marketplaceChange,
  })
  .strict();
export const changeLabels: Record<MarketplaceChange["kind"], string> = {
  "offer.price": "Change unit price",
  "offer.quantity": "Change quantity",
  "offer.details": "Replace offer details",
  "offer.create": "Create predefined offer",
  "order.deliver": "Mark delivered",
  "order.cancel": "Cancel order",
  "order.extend": "Extend delivery time",
};
