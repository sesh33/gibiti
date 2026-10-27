export const documentedOfferReadEndpoints = {
  currency: "/api/v1/currency-management/me/offers",
  items: "/api/v1/item-management/me/offers/me/search",
  flexible: "/api/flexibleOffers/me/search",
  predefined: "/api/predefinedOffers/me",
} as const;
// Response and pagination contracts must be verified before a live adapter is enabled.
export const offerIntegrationStatus = {
  connected: false,
  reason:
    "Official offer response schemas and mutation payloads have not been supplied or independently verified.",
};
