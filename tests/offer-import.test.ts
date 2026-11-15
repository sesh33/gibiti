import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: mocked.insert }) }),
}));
import {
  buildImportPreview,
  importColumns,
  parseOfferImport,
} from "@/domains/offers/import";
import type { requireStaff } from "@/domains/authentication/session";
const row = {
  gameId: "verified-game",
  category: "TopUp",
  tradeEnvironmentId: "verified-environment",
  description: "Synthetic public product",
  guaranteedDeliveryTime: "Minute20",
  quantity: 10,
  minQuantity: 1,
  amount: 0.00109,
  currency: "USD",
  deliveryMethod: "InGameTrade",
};
const json = (rows: unknown[] = [row]) => ({
  format: "json",
  text: JSON.stringify(rows),
});
const csv = (cells: string[]) => ({
  format: "csv",
  text: importColumns.join(",") + "\r\n" + cells.join(","),
});
function staff(permissions = ["offers.read", "offers.create"]) {
  return {
    user: { id: "11111111-1111-4111-8111-111111111111" },
    permissions: new Set(permissions),
  } as unknown as Awaited<ReturnType<typeof requireStaff>>;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocked.insert.mockReturnValue({
    select: () => ({
      single: async () => ({
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          expires_at: "2026-11-15T01:00:00Z",
        },
        error: null,
      }),
    }),
  });
});
it("converts flat JSON into only the strict documented creation DTO", () => {
  const result = parseOfferImport(json());
  expect(result.valid).toBe(true);
  expect(result.items[0].document).toEqual({
    details: {
      description: row.description,
      guaranteedDeliveryTime: "Minute20",
      pricing: {
        quantity: 10,
        minQuantity: 1,
        volumeDiscounts: [],
        pricePerUnit: { amount: 0.00109, currency: "USD" },
      },
      deliveryMethod: "InGameTrade",
    },
    augmentedGame: {
      gameId: "verified-game",
      category: "TopUp",
      tradeEnvironmentId: "verified-environment",
      offerAttributes: [],
    },
    giftCardDetails: null,
  });
});
it("reads BOM, CRLF, quoted comma/newline/escaped quote and retains physical CSV line numbers", () => {
  const cells = importColumns.map((name) => String(row[name]));
  cells[3] = '"Hello, buyer\r\nUse ""verified"" IDs"';
  const input = csv(cells);
  input.text = "\uFEFF" + input.text;
  const result = parseOfferImport(input);
  expect(result.valid).toBe(true);
  expect(result.items[0].row).toBe(2);
  expect(result.items[0].document.details.description).toBe(
    'Hello, buyer\nUse "verified" IDs',
  );
});
it("rejects unknown or duplicate headers, malformed quotes and wrong cell counts", () => {
  for (const text of [
    "gameId,gameId\nx,y",
    importColumns.join(",") + ",secret\nx",
    importColumns.join(",") + '\n"unfinished',
    importColumns.join(",") + "\njust-one-cell",
  ]) {
    const result = parseOfferImport({ format: "csv", text });
    expect(result.valid).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.problems.length).toBeGreaterThan(0);
  }
});
it("reports every invalid product and does not keep a partial valid selection", () => {
  const result = parseOfferImport(
    json([
      row,
      {
        ...row,
        gameId: "second",
        amount: "",
        quantity: "bad",
        currency: "FAKE",
        guaranteedDeliveryTime: "Minute7",
      },
    ]),
  );
  expect(result.valid).toBe(false);
  expect(result.items).toEqual([]);
  expect(result.problems.length).toBe(4);
  expect(result.problems.every((problem) => problem.row === 2)).toBe(true);
});
it("rejects arbitrary attributes, gift-card codes, unknown fields and nested DTO bypasses", () => {
  for (const extra of [
    { giftCardDetails: [{ code: "synthetic-secret" }] },
    { offerAttributes: [{ region: "invented" }] },
    { clientSecret: "synthetic-secret" },
    { details: {} },
  ]) {
    const result = parseOfferImport(json([{ ...row, ...extra }]));
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  }
});
it("rejects duplicate products and files outside the ten-row limit", () => {
  expect(parseOfferImport(json([row, row])).problems[0].message).toContain(
    "duplicates row 1",
  );
  expect(parseOfferImport(json([])).valid).toBe(false);
  expect(
    parseOfferImport(
      json(
        Array.from({ length: 11 }, (_, index) => ({
          ...row,
          gameId: String(index),
        })),
      ),
    ).valid,
  ).toBe(false);
});
it("preserves a zero stock level as zero, rejects numeric coercion and normalizes absent environment to null", () => {
  const result = parseOfferImport(
    json([{ ...row, quantity: 0, tradeEnvironmentId: "" }]),
  );
  expect(result.items[0].document.details.pricing.quantity).toBe(0);
  expect(result.items[0].document.augmentedGame.tradeEnvironmentId).toBeNull();
  for (const amount of [null, true, "1,09", "Infinity", "1e-3", -1])
    expect(parseOfferImport(json([{ ...row, amount }])).valid).toBe(false);
});
it("rejects non-array JSON and bounds file bytes as well as characters", () => {
  expect(
    parseOfferImport({ format: "json", text: JSON.stringify(row) }).valid,
  ).toBe(false);
  expect(parseOfferImport({ format: "json", text: "[" }).valid).toBe(false);
  expect(() =>
    parseOfferImport({ format: "csv", text: "é".repeat(25000) }),
  ).toThrow("48 KB");
});
it("never saves malformed or unauthorized imports and saves a valid preview without any marketplace adapter", async () => {
  expect(
    (await buildImportPreview(json([{ ...row, amount: 0 }]), staff())).valid,
  ).toBe(false);
  expect(mocked.insert).not.toHaveBeenCalled();
  await expect(
    buildImportPreview(json(), staff(["offers.create"])),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocked.insert).not.toHaveBeenCalled();
  const result = await buildImportPreview(json(), staff());
  expect(result.valid).toBe(true);
  expect(result).toHaveProperty("id");
  expect(mocked.insert).toHaveBeenCalledOnce();
  expect(
    mocked.insert.mock.calls[0][0].items[0].document.giftCardDetails,
  ).toBeNull();
});
