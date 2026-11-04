import { it, expect } from "vitest";
import { eldoradoClient } from "@/domains/eldorado/client";
import { normalizeOrder } from "@/domains/orders/service";
import { readSellerOfferPage } from "@/domains/offers/service";
const enabled = process.env.RIVOX_LIVE_READS === "true";
it.skipIf(!enabled)(
  "validates authorized real order reads and normalization without upstream mutations",
  async () => {
    const page = await eldoradoClient().orders();
    for (const order of page.results) {
      const normalized = normalizeOrder(order);
      expect(normalized.id).toBe(order.id);
      expect(typeof normalized.product_title).toBe("string");
    }
    console.log(
      "Live authorized order read: " +
        page.results.length +
        " records; no upstream writes.",
    );
  },
  60000,
);
it.skipIf(!enabled)(
  "validates official flexible, predefined, item, and currency offer read contracts",
  async () => {
    for (const source of [
      "flexible",
      "predefined",
      "items",
      "currency",
    ] as const) {
      const result = await readSellerOfferPage(source);
      expect(Array.isArray(result.items)).toBe(true);
      if (source !== "items" && result.items.length) {
        const listing = result.items[0];
        const state = await eldoradoClient().offerState(
          source,
          listing.native_id,
        );
        expect(state.id.toLowerCase()).toBe(listing.native_id.toLowerCase());
        expect(typeof state.state).toBe("string");
        expect(Object.keys(state).sort()).toEqual(["id", "state"]);
      }
      console.log(
        "Live authorized " +
          source +
          " listing read: " +
          result.items.length +
          " records; no upstream writes.",
      );
    }
  },
  60000,
);
