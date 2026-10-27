export const offerSources = [
  "flexible",
  "predefined",
  "items",
  "currency",
] as const;
export type OfferSource = (typeof offerSources)[number];
export const sourceLabels: Record<OfferSource, string> = {
  flexible: "Flexible accounts",
  predefined: "Predefined listings",
  items: "Items",
  currency: "Currency",
};
export const documentedOfferReadEndpoints: Record<OfferSource, string> = {
  flexible: "/api/flexibleOffers/me/search",
  predefined: "/api/predefinedOffers/me",
  items: "/api/v1/item-management/me/offers/me/search",
  currency: "/api/v1/currency-management/me/offers",
};
