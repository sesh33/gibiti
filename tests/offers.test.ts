import { describe, expect, it } from "vitest";
import { normalizeOffer, parseSellerOfferPage } from "@/domains/offers/schemas";
const id = "11111111-1111-4111-8111-111111111111";
const offer = {
  id,
  offerTitle: "Synthetic listing",
  category: "Account",
  gameId: "fixture-game",
  offerState: "Active",
  quantity: 2,
  pricePerUnit: { amount: 15.5, currency: "USD" },
};
const page = {
  pageIndex: 1,
  pageSize: 10,
  recordCount: 1,
  totalPages: 1,
  results: [offer],
};
describe("verified seller offer read normalization", () => {
  it("retains actual unit price, currency, quantity, and state from a valid response", () => {
    const parsed = parseSellerOfferPage(page);
    expect(
      normalizeOffer(parsed.results[0], "flexible", "2026-10-27T12:00:00Z"),
    ).toEqual({
      id: "flexible:" + id,
      native_id: id,
      source: "flexible",
      category: "Account",
      title: "Synthetic listing",
      state: "Active",
      price: 15.5,
      currency: "USD",
      quantity: 2,
      game_id: "fixture-game",
      updated_at: "2026-10-27T12:00:00Z",
    });
  });
  it("uses the listing reference when a predefined response has no title, without inventing product details", () => {
    const untitled = { ...offer, offerTitle: undefined };
    const parsed = parseSellerOfferPage({ ...page, results: [untitled] });
    expect(normalizeOffer(parsed.results[0], "predefined").title).toBe(
      "Listing 11111111",
    );
  });
  it("keeps missing prices and quantities explicitly unknown instead of fabricating zero values", () => {
    const parsed = parseSellerOfferPage({
      ...page,
      results: [
        {
          id,
          category: "Item",
          offerState: "Paused",
          quantity: null,
          pricePerUnit: null,
        },
      ],
    });
    const normalized = normalizeOffer(parsed.results[0], "items");
    expect(normalized.price).toBeNull();
    expect(normalized.currency).toBeNull();
    expect(normalized.quantity).toBeNull();
  });
  it("drops raw description, delivery credentials, and other private payload fields", () => {
    const parsed = parseSellerOfferPage({
      ...page,
      results: [
        {
          ...offer,
          description: "private fixture",
          accountDetails: { password: "private fixture" },
          token: "private fixture",
        },
      ],
    });
    expect(
      JSON.stringify(normalizeOffer(parsed.results[0], "flexible")),
    ).not.toContain("private fixture");
  });
  it("accepts an authenticated empty list as a real empty result", () => {
    expect(
      parseSellerOfferPage({
        ...page,
        recordCount: 0,
        totalPages: 0,
        results: [],
      }).results,
    ).toEqual([]);
  });
  it("rejects unknown containers or malformed supplied money without persisting a partial page", () => {
    expect(() => parseSellerOfferPage([offer])).toThrow(
      "No records were stored",
    );
    expect(() =>
      parseSellerOfferPage({
        ...page,
        results: [
          { ...offer, pricePerUnit: { amount: "15", currency: "USD" } },
        ],
      }),
    ).toThrow("No records were stored");
  });
  it("uses source-qualified identifiers to avoid collisions across listing families", () => {
    const row = parseSellerOfferPage(page).results[0];
    expect(normalizeOffer(row, "flexible").id).not.toBe(
      normalizeOffer(row, "predefined").id,
    );
  });
});
