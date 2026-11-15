import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ snapshot: vi.fn(), read: vi.fn() }));
vi.mock("@/domains/eldorado/client", () => ({
  eldoradoClient: () => ({
    predefinedSnapshot: fixture.snapshot,
    read: fixture.read,
  }),
}));
import { comparePredefinedOffers } from "@/domains/offers/comparison";
const id = "11111111-1111-4111-8111-111111111111";
const context = {
  minQuantity: 2,
  unitSystem: "Unit1",
  deliveryMethod: "InGameTrade",
  attributes: [],
  tradeEnvironmentValues: [],
  offerAttributeIdValues: [],
};
const own = {
  id,
  sellerId: "fixture-seller",
  gameId: "fixture-game",
  category: "Currency",
  currency: "USD",
  contextComplete: true,
  context,
};
beforeEach(() => {
  fixture.snapshot.mockReset();
  fixture.read.mockReset();
});

it("blocks unverified top-up dimensions before collecting a competitor page", async () => {
  fixture.snapshot.mockResolvedValue({ ...own, category: "TopUp" });
  const response = await comparePredefinedOffers(id);
  expect(response).toMatchObject({ complete: false, items: [] });
  expect(response.message).toContain(
    "Local catalog labels do not prove equivalence",
  );
  expect(fixture.read).not.toHaveBeenCalled();
});

it("excludes own seller, unknown sellers and stock below the advertised minimum", async () => {
  fixture.snapshot.mockResolvedValue(own);
  const candidate = {
    id: "22222222-2222-4222-8222-222222222222",
    userId: "competitor",
    gameId: own.gameId,
    category: own.category,
    offerState: "Active",
    quantity: 5,
    pricePerUnit: { amount: 1.01, currency: "USD" },
    ...context,
  };
  fixture.read.mockResolvedValue({
    pageIndex: 1,
    totalPages: 1,
    results: [
      { offer: { ...candidate, userId: "fixture-seller" } },
      { offer: { ...candidate, userId: undefined } },
      { offer: { ...candidate, quantity: 1 } },
      { offer: candidate },
    ],
  });
  const response = await comparePredefinedOffers(id);
  expect(response.items).toHaveLength(1);
  expect(response.items[0].price).toBe(1.01);
});
