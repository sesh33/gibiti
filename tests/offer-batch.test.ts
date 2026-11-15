import { beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  records: vi.fn(),
  policies: vi.fn(),
  insert: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: string) =>
      table === "repricing_policies"
        ? { select: () => ({ in: mocked.policies }) }
        : { insert: mocked.insert },
  }),
}));
import { buildBatchPreview } from "@/domains/offers/batch";
import type { EldoradoClient } from "@/domains/eldorado/client";
import type { requireStaff } from "@/domains/authentication/session";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
function staff(
  permissions = [
    "offers.read",
    "offers.update_price",
    "offers.update_stock",
    "offers.create",
  ],
) {
  return {
    user: { id: ids[0] },
    permissions: new Set(permissions),
    db: { from: () => ({ select: () => ({ in: mocked.records }) }) },
  } as unknown as Awaited<ReturnType<typeof requireStaff>>;
}
const client = {
  predefinedSnapshot: mocked.snapshot,
} as unknown as EldoradoClient;
const input = {
  offerIds: ids.map((id) => "predefined:" + id),
  change: { kind: "price", amount: 1.95, currency: "USD" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocked.records.mockResolvedValue({
    data: ids.map((id) => ({
      id: "predefined:" + id,
      native_id: id,
      title: "Synthetic",
      currency: "USD",
      updated_at: "2026-11-13T00:00:00Z",
    })),
    error: null,
  });
  mocked.policies.mockResolvedValue({
    data: [{ native_id: ids[0], floor: 1.5, currency: "USD" }],
    error: null,
  });
  mocked.snapshot.mockImplementation(async (id) => ({
    id,
    state: "Active",
    price: 2,
    currency: "USD",
    quantity: 10,
    document: null,
  }));
  mocked.insert.mockReturnValue({
    select: () => ({
      single: async () => ({
        data: { id: ids[0], expires_at: "2026-11-13T01:00:00Z" },
        error: null,
      }),
    }),
  });
});
it("previews exact targets with current values and preserves the primitive stock contract", async () => {
  const result = await buildBatchPreview(
    { ...input, change: { kind: "quantity", quantity: 5 } },
    staff(),
    client,
  );
  expect(result.valid).toBe(true);
  expect(result.items).toHaveLength(2);
  expect(result.items[0].change).toEqual({ kind: "offer.quantity", body: 5 });
  expect(mocked.insert).toHaveBeenCalledOnce();
});
it("blocks the whole preview on a floor violation, incompatible currency or unavailable listing", async () => {
  const result = await buildBatchPreview(
    { ...input, change: { kind: "price", amount: 1, currency: "USD" } },
    staff(),
    client,
  );
  expect(result.valid).toBe(false);
  expect(result.problems[0].code).toBe("BATCH_FLOOR_VIOLATION");
  expect(mocked.insert).not.toHaveBeenCalled();
  const other = await buildBatchPreview(
    { ...input, change: { kind: "price", amount: 2, currency: "EUR" } },
    staff(),
    client,
  );
  expect(other.valid).toBe(false);
  expect(mocked.insert).not.toHaveBeenCalled();
  mocked.snapshot.mockResolvedValueOnce({ id: ids[0], state: "Closed" });
  expect((await buildBatchPreview(input, staff(), client)).valid).toBe(false);
});
it("requires stock and pricing authority for delivery replacements and blocks incomplete metadata", async () => {
  const delivery = {
    ...input,
    change: { kind: "delivery", deliveryTime: "Minute20" },
  };
  await expect(
    buildBatchPreview(
      delivery,
      staff(["offers.read", "offers.create"]),
      client,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocked.snapshot).not.toHaveBeenCalled();
  const result = await buildBatchPreview(delivery, staff(), client);
  expect(result.valid).toBe(false);
  expect(result.problems[0].code).toBe("BATCH_DETAILS_INCOMPLETE");
  expect(mocked.insert).not.toHaveBeenCalled();
});
it("rejects duplicate selection, denied permissions and missing local snapshots before provider reads", async () => {
  await expect(
    buildBatchPreview(
      { ...input, offerIds: [input.offerIds[0], input.offerIds[0]] },
      staff(),
      client,
    ),
  ).rejects.toThrow();
  await expect(
    buildBatchPreview(input, staff(["offers.read"]), client),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  mocked.records.mockResolvedValueOnce({ data: [], error: null });
  await expect(buildBatchPreview(input, staff(), client)).rejects.toMatchObject(
    { code: "BATCH_TARGET_UNAVAILABLE" },
  );
  expect(mocked.snapshot).not.toHaveBeenCalled();
});
it("enforces current economic assumptions in previews and blocks expired assumptions", async () => {
  const economics = {
    unitCost: 2,
    feePercent: 10,
    fixedFee: 0,
    comparisonQuantity: 1,
    minMarginPercent: 10,
    verifiedAt: new Date(Date.now() - 1000).toISOString(),
    validUntil: new Date(Date.now() + 60000).toISOString(),
  };
  mocked.policies.mockResolvedValue({
    data: [{ native_id: ids[0], floor: 1.5, currency: "USD", economics }],
    error: null,
  });
  const protectedPreview = await buildBatchPreview(input, staff(), client);
  expect(protectedPreview.valid).toBe(false);
  expect(protectedPreview.problems[0].code).toBe("BATCH_FLOOR_VIOLATION");
  expect(mocked.insert).not.toHaveBeenCalled();
  mocked.policies.mockResolvedValue({
    data: [
      {
        native_id: ids[0],
        floor: 1.5,
        currency: "USD",
        economics: {
          ...economics,
          validUntil: new Date(Date.now() - 1).toISOString(),
        },
      },
    ],
    error: null,
  });
  const expired = await buildBatchPreview(
    { ...input, change: { kind: "price", amount: 5, currency: "USD" } },
    staff(),
    client,
  );
  expect(expired.valid).toBe(false);
  expect(expired.problems[0].code).toBe("BATCH_ECONOMICS_UNVERIFIED");
  expect(mocked.insert).not.toHaveBeenCalled();
});
