import { it, expect } from "vitest";
import { eldoradoClient } from "@/domains/eldorado/client";
import { normalizeOrder } from "@/domains/orders/service";
import { readSellerOfferPage } from "@/domains/offers/service";
import { comparePredefinedOffers } from "@/domains/offers/comparison";
import {
  readNotifications,
  readSellerOverview,
} from "@/domains/eldorado/seller-tools";
const enabled = process.env.RIVOX_LIVE_READS === "true";
it.skipIf(!enabled)(
  "verifies official Seller diagnostics, notifications, CSV reports and PDF invoice without commercial writes",
  async () => {
    const client = eldoradoClient(),
      notifications = await readNotifications(undefined, client),
      overview = await readSellerOverview(client);
    expect(Array.isArray(notifications.items)).toBe(true);
    expect(overview.checks.every((check) => check.ok)).toBe(true);
    const until = new Date().toISOString().slice(0, 10),
      from = until.slice(0, 7) + "-01";
    for (const kind of ["orders", "sold-orders", "invoice"] as const) {
      const report = await client.downloadReport({ kind, from, until });
      expect(report.type).toBe(kind === "invoice" ? "pdf" : "csv");
      expect(report.bytes.byteLength > 0).toBe(true);
    }
  },
  60000,
);
it.skipIf(!enabled)(
  "validates authorized real order reads and normalization without upstream mutations",
  async () => {
    const page = await eldoradoClient().orders();
    if (page.nextPageCursor) {
      const next = await eldoradoClient().orders(page.nextPageCursor);
      const seen = new Set(page.results.map((order) => order.id));
      expect(next.results.some((order) => seen.has(order.id))).toBe(false);
    }
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
  "validates predefined private fields and public comparable pages without writes",
  async () => {
    const page = await readSellerOfferPage("predefined");
    if (!page.items.length) return;
    const snapshot = await eldoradoClient().predefinedSnapshot(
      page.items[0].native_id,
    );
    expect(snapshot.id.toLowerCase()).toBe(
      page.items[0].native_id.toLowerCase(),
    );
    expect(typeof snapshot.price).toBe("number");
    expect(Object.keys(snapshot)).not.toContain("user");
    const comparison = await comparePredefinedOffers(snapshot.id);
    expect(Array.isArray(comparison.items)).toBe(true);
    console.log(
      "Private predefined and public comparison reads verified; no upstream writes.",
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
