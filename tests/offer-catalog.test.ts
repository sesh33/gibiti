import { describe, expect, it } from "vitest";
import {
  catalogQuery,
  catalogReadIsRecent,
  catalogStockLabel,
  catalogTagsInput,
  escapeLikeSearch,
  selectPublicContextEntries,
} from "@/domains/offers/catalog";

describe("operational catalog boundaries", () => {
  it("preserves Unicode searches and escapes wildcard characters literally", () => {
    expect(
      catalogQuery.parse({ search: "  Moedas São Paulo 東京  " }).search,
    ).toBe("Moedas São Paulo 東京");
    expect(escapeLikeSearch("São_100%,(x)\\")).toBe("São\\_100\\%,(x)\\\\");
    expect(catalogQuery.safeParse({ stock: "ready" }).success).toBe(false);
    expect(catalogQuery.safeParse({ delivery: "UnknownEnum" }).success).toBe(
      false,
    );
  });
  it("does not confuse state, stock, unknown minimum, or stale snapshots", () => {
    expect(catalogStockLabel({ quantity: null })).toBe("Stock unknown");
    expect(catalogStockLabel({ quantity: 0, min_quantity: 1 })).toBe(
      "Out of stock",
    );
    expect(catalogStockLabel({ quantity: 3, min_quantity: 5 })).toBe(
      "Below minimum order",
    );
    expect(catalogStockLabel({ quantity: 3 })).toContain("minimum unknown");
    expect(catalogStockLabel({ quantity: 5, min_quantity: 5 })).toBe(
      "Stock meets minimum",
    );
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(catalogReadIsRecent("2026-11-15T11:45:00Z", now)).toBe(true);
    expect(catalogReadIsRecent("2026-11-15T11:44:59Z", now)).toBe(false);
    expect(catalogReadIsRecent("2026-11-15T12:00:01Z", now)).toBe(false);
    expect(catalogReadIsRecent("invalid", now)).toBe(false);
  });
  it("only accepts bounded local labels and never accepts upstream attribute overrides", () => {
    expect(
      catalogTagsInput.parse({
        offerId: "predefined:fixture",
        region: " Europe ",
        platform: "PC",
        denomination: "1000",
      }).region,
    ).toBe("Europe");
    expect(
      catalogTagsInput.safeParse({
        offerId: "x",
        region: "a".repeat(101),
        platform: "",
        denomination: "",
      }).success,
    ).toBe(false);
    expect(
      catalogTagsInput.safeParse({
        offerId: "x",
        region: "",
        platform: "",
        denomination: "",
        attributes: [],
      }).success,
    ).toBe(false);
  });
  it("selects a bounded public context without arbitrary nested vendor data", () => {
    expect(
      selectPublicContextEntries([
        null,
        "raw",
        { id: "a", value: "EU", privateAccount: { password: "secret" } },
        { values: ["PC", { secret: "secret" }] },
      ]),
    ).toEqual([{ id: "a", value: "EU" }, { values: ["PC"] }]);
    expect(
      selectPublicContextEntries(
        Array.from({ length: 101 }, () => ({ name: "x".repeat(300) })),
      ),
    ).toHaveLength(100);
  });
});
