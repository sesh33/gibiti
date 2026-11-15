import { expect, it, vi } from "vitest";
import {
  buildPricingQuote,
  choosePrice,
  pricingContextHash,
  pricingFreshnessGuard,
  validateQuoteBeforeWrite,
} from "@/domains/pricing/quotes";
import type { EldoradoClient } from "@/domains/eldorado/client";
import type { PricingEconomics, PricingPolicy } from "@/domains/pricing/models";
import { AppError } from "@/lib/errors";
const ownId = "11111111-1111-4111-8111-111111111111",
  peerId = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-11-15T12:00:00Z");
const economics: PricingEconomics = {
  unitCost: 1,
  feePercent: 10,
  fixedFee: 0.1,
  comparisonQuantity: 1,
  minMarginPercent: 30,
  verifiedAt: "2026-11-15T11:00:00Z",
  validUntil: "2026-11-16T11:00:00Z",
};
const details = {
  description: "Synthetic",
  guaranteedDeliveryTime: "Minute20" as const,
  pricing: {
    quantity: 10,
    minQuantity: 1,
    volumeDiscounts: [],
    pricePerUnit: { amount: 2, currency: "USD" as const },
  },
  deliveryMethod: "InGameTrade" as const,
};
function own() {
  return {
    id: ownId,
    sellerId: "own-seller",
    state: "Active",
    price: 2,
    currency: "USD",
    quantity: 10,
    gameId: "fixture-game",
    category: "Currency",
    details,
    contextComplete: true,
    context: {
      minQuantity: 1,
      unitSystem: "Unit1",
      deliveryMethod: "InGameTrade",
      attributes: [],
      tradeEnvironmentValues: [],
      offerAttributeIdValues: [],
    },
    document: null,
  };
}
function peer() {
  return {
    id: peerId,
    userId: "other-seller",
    gameId: "fixture-game",
    category: "Currency",
    offerState: "Active",
    quantity: 10,
    minQuantity: 1,
    pricePerUnit: { amount: 2, currency: "USD" },
    unitSystem: "Unit1",
    deliveryMethod: "InGameTrade",
    guaranteedDeliveryTime: "Minute20",
    volumeDiscounts: [],
    attributes: [],
    tradeEnvironmentValues: [],
    offerAttributeIdValues: [],
  };
}
const policy = {
  id: ownId,
  offer_id: "predefined:" + ownId,
  native_id: ownId,
  currency: "USD",
  floor: 1.5,
  difference: 0.05,
  decimals: 2,
  mode: "manual",
  interval_seconds: 300,
  version: peerId,
  created_by: ownId,
  approved_by: null,
  review_status: "not_required",
  last_checked_at: null,
  last_error_code: null,
  next_run_at: "2026-11-13T00:00:00Z",
  economics_context_hash: pricingContextHash(own()),
} satisfies PricingPolicy;
function fixture(pages: unknown[][] = [[{ offer: peer() }]], snapshot = own()) {
  const read = vi.fn(
    async <T>(
      _path: string,
      parser: (data: unknown) => T,
      query?: Record<string, string>,
    ): Promise<T> => {
      const index = Number(query?.pageIndex ?? 1);
      return parser({
        pageIndex: index,
        totalPages: pages.length,
        results: pages[index - 1],
      });
    },
  );
  const client = {
    predefinedSnapshot: async () => snapshot,
    read,
  } as unknown as EldoradoClient;
  return { client, read };
}
it("simulates only a complete equivalent market and never undercuts its floor", async () => {
  const f = fixture(),
    quote = await buildPricingQuote(policy, f.client);
  expect(quote.amount).toBe(1.95);
  expect(quote.proof).toMatchObject({
    complete: true,
    pages: 1,
    equivalentOffers: 1,
  });
  const floorQuote = await buildPricingQuote(
    { ...policy, floor: 2.5 },
    f.client,
  );
  expect(floorQuote.amount).toBe(2.5);
});
it("preserves floor safety at rounding boundaries and rejects unsafe magnitudes", () => {
  for (const floor of [0.1 + 0.2, 0.00000001, 1.00000001, 9.99999999, 99.99])
    for (const decimals of [0, 2, 4, 8])
      expect(choosePrice(0.01, floor, 0.1, decimals)).toBeGreaterThanOrEqual(
        floor,
      );
  expect(() => choosePrice(1e20, 1, 0, 8)).toThrow("represented safely");
});
it("does not compare other packages, units, environments, discounts, currencies or own offers", async () => {
  const valid = peer();
  const variants = [
    { ...peer(), userId: "own-seller" },
    { ...peer(), gameId: "different" },
    { ...peer(), category: "Account" },
    { ...peer(), unitSystem: "Unit1000" },
    { ...peer(), deliveryMethod: "GamePass" },
    { ...peer(), guaranteedDeliveryTime: "Day1" },
    { ...peer(), minQuantity: 5 },
    { ...peer(), attributes: [{ id: "other-package" }] },
    { ...peer(), tradeEnvironmentValues: ["other-platform"] },
    { ...peer(), offerAttributeIdValues: ["other-package"] },
    { ...peer(), volumeDiscounts: [{ quantity: 2, percentage: 10 }] },
    { ...peer(), pricePerUnit: { amount: 0.01, currency: "EUR" } },
    { ...peer(), quantity: 0.5 },
  ].map((offer, index) => ({
    offer: {
      ...offer,
      id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
      pricePerUnit:
        offer.pricePerUnit.currency === "EUR"
          ? offer.pricePerUnit
          : { amount: 0.01, currency: "USD" },
    },
  }));
  const f = fixture([[...variants, { offer: valid }]]),
    quote = await buildPricingQuote(policy, f.client);
  expect(quote.amount).toBe(1.95);
  expect(quote.proof.equivalentOffers).toBe(1);
});
it("blocks ambiguous active offers even when some candidates are valid", async () => {
  const partial: Record<string, unknown> = { ...peer() };
  delete partial.attributes;
  await expect(
    buildPricingQuote(
      policy,
      fixture([
        [
          { offer: peer() },
          { offer: { ...partial, id: "44444444-4444-4444-8444-444444444444" } },
        ],
      ]).client,
    ),
  ).rejects.toMatchObject({ code: "COMPARISON_AMBIGUOUS" });
});
it("ignores known inactive or out-of-stock rows without inventing metadata", async () => {
  const f = fixture([
    [
      { offer: peer() },
      {
        offer: {
          id: "44444444-4444-4444-8444-444444444444",
          offerState: "Paused",
          quantity: 1,
        },
      },
      {
        offer: {
          id: "55555555-5555-4555-8555-555555555555",
          offerState: "Active",
          quantity: 0,
        },
      },
    ],
  ]);
  expect(
    (await buildPricingQuote(policy, f.client)).proof.equivalentOffers,
  ).toBe(1);
});
it("checks all permitted pages and blocks budget or pagination ambiguity", async () => {
  const second = {
    ...peer(),
    id: "44444444-4444-4444-8444-444444444444",
    pricePerUnit: { amount: 1.8, currency: "USD" },
  };
  const f = fixture([[{ offer: peer() }], [{ offer: second }]]);
  expect((await buildPricingQuote(policy, f.client)).amount).toBe(1.75);
  expect(f.read).toHaveBeenCalledTimes(2);
  await expect(
    buildPricingQuote(
      policy,
      fixture(Array.from({ length: 6 }, () => [{ offer: peer() }])).client,
    ),
  ).rejects.toMatchObject({ code: "COMPARISON_INCOMPLETE" });
  await expect(
    buildPricingQuote(
      policy,
      fixture([[{ offer: peer() }], [{ offer: peer() }]]).client,
    ),
  ).rejects.toMatchObject({ code: "COMPARISON_INCOMPLETE" });
});
it("refuses unknown own context, paused stock and empty comparison sets", async () => {
  const f = fixture([], { ...own(), contextComplete: false });
  await expect(buildPricingQuote(policy, f.client)).rejects.toMatchObject({
    code: "COMPARISON_BLOCKED",
  });
  expect(f.read).not.toHaveBeenCalled();
  await expect(
    buildPricingQuote(policy, fixture([[]]).client),
  ).rejects.toMatchObject({ code: "NO_EQUIVALENT_OFFERS" });
  await expect(
    buildPricingQuote(
      policy,
      fixture([[{ offer: peer() }]], { ...own(), state: "Paused" }).client,
    ),
  ).rejects.toMatchObject({ code: "COMPARISON_BLOCKED" });
});
it("propagates provider backoff instead of manufacturing a recommendation", async () => {
  const f = fixture();
  f.read.mockRejectedValueOnce(
    new AppError("ELDORADO_RATE_LIMITED", "Wait.", 429, 3600),
  );
  await expect(buildPricingQuote(policy, f.client)).rejects.toMatchObject({
    code: "ELDORADO_RATE_LIMITED",
    retryAfter: 3600,
  });
});

it("uses a rounded economic floor and records auditable current estimates", async () => {
  const result = await buildPricingQuote(
    {
      ...policy,
      floor: 0.5,
      economics: { ...economics, minMarginPercent: 50 },
    },
    fixture().client,
    () => now,
  );
  expect(result.amount).toBe(2.75);
  expect(result.proof).toMatchObject({
    executable: true,
    blockedReason: null,
    configuredFloor: 0.5,
    effectiveFloor: 2.75,
    collectionStartedAt: "2026-11-15T12:00:00.000Z",
    observedAt: "2026-11-15T12:00:00.000Z",
    validUntil: "2026-11-15T12:01:00.000Z",
    comparisonQuantity: 1,
    economics: {
      source: "owner-estimate",
      grossRevenue: 2.75,
      fees: 0.375,
      netRevenue: 2.375,
      totalCost: 1,
      profit: 1.375,
      marginPercent: 50,
    },
  });
});

it("retains simulations without allowing execution with missing, expired or discounted economics", async () => {
  for (const basis of [
    undefined,
    { ...economics, validUntil: "2026-11-15T12:00:00Z" },
  ]) {
    const result = await buildPricingQuote(
      { ...policy, economics: basis },
      fixture().client,
      () => now,
    );
    expect(result.amount).toBe(1.95);
    expect(result.proof.executable).toBe(false);
    expect(result.proof.blockedReason).toBeTruthy();
  }
  const discounts = [{ quantity: 2, percentage: 10 }];
  const snapshot = own();
  snapshot.details = {
    ...details,
    pricing: { ...details.pricing, volumeDiscounts: discounts },
  } as typeof snapshot.details;
  const result = await buildPricingQuote(
    { ...policy, economics },
    fixture([[{ offer: { ...peer(), volumeDiscounts: discounts } }]], snapshot)
      .client,
    () => now,
  );
  expect(result.proof.executable).toBe(false);
  expect(result.proof.blockedReason).toContain("tier-specific");
});

it("does not carry cost authority across a changed product or package", async () => {
  const snapshot = { ...own(), gameId: "changed-game" };
  const result = await buildPricingQuote(
    { ...policy, economics },
    fixture([[{ offer: { ...peer(), gameId: "changed-game" } }]], snapshot)
      .client,
    () => now,
  );
  expect(result.proof.executable).toBe(false);
  expect(result.proof.blockedReason).toContain("context changed");
  expect(result.proof.contextHash).not.toBe(policy.economics_context_hash);
});

it("blocks discounted effective prices even without volume tiers", async () => {
  for (const discount of [
    { discountPercentage: 10 },
    { pricePerUnitWithDiscount: { amount: 1.5, currency: "USD" } },
    { pricePerUnitWithDiscount: { amount: "unknown", currency: "USD" } },
  ]) {
    await expect(
      buildPricingQuote(
        { ...policy, economics },
        fixture([[{ offer: { ...peer(), ...discount } }]]).client,
        () => now,
      ),
    ).rejects.toMatchObject({ code: "COMPARISON_AMBIGUOUS" });
  }
  const snapshot = {
    ...own(),
    discount: {
      pricePerUnitWithDiscount: { amount: 1.5, currency: "USD" },
      discountPercentage: 25,
      unverified: false,
    },
  };
  await expect(
    buildPricingQuote(
      { ...policy, economics },
      fixture(undefined, snapshot).client,
      () => now,
    ),
  ).rejects.toMatchObject({ code: "DISCOUNT_REVIEW_REQUIRED" });
});

it("requires stock for the exact comparison basket without matching stock totals", async () => {
  const configured = {
    ...policy,
    economics: { ...economics, comparisonQuantity: 2, fixedFee: 0 },
  };
  const sufficient = fixture([[{ offer: { ...peer(), quantity: 3 } }]]);
  expect(
    (await buildPricingQuote(configured, sufficient.client, () => now)).proof
      .executable,
  ).toBe(true);
  await expect(
    buildPricingQuote(
      configured,
      fixture([[{ offer: { ...peer(), quantity: 1 } }]]).client,
      () => now,
    ),
  ).rejects.toMatchObject({ code: "NO_EQUIVALENT_OFFERS" });
  await expect(
    buildPricingQuote(
      configured,
      fixture(undefined, { ...own(), quantity: 1 }).client,
      () => now,
    ),
  ).rejects.toMatchObject({ code: "COMPARISON_QUANTITY_UNAVAILABLE" });
});

it("does not amortize a fixed fee over more units than a buyer must actually buy", async () => {
  const result = await buildPricingQuote(
    {
      ...policy,
      economics: { ...economics, fixedFee: 0.2, comparisonQuantity: 2 },
    },
    fixture().client,
    () => now,
  );
  expect(result.proof.executable).toBe(false);
  expect(result.proof.blockedReason).toContain("minimum purchase quantity");
});

it("fails closed for top-ups without authoritative dimensional mapping", async () => {
  const f = fixture(undefined, { ...own(), category: "TopUp" });
  await expect(
    buildPricingQuote({ ...policy, economics }, f.client, () => now),
  ).rejects.toMatchObject({ code: "TOPUP_COMPARISON_UNVERIFIED" });
  expect(f.read).not.toHaveBeenCalled();
});

it("refuses slow or future-dated market collection and catches expiry after OAuth or a claim", async () => {
  let clock = now;
  const f = fixture();
  const originalRead = f.read.getMockImplementation()!;
  f.read.mockImplementation(async (...args) => {
    const result = await originalRead(...args);
    clock += 60_000;
    return result;
  });
  await expect(
    buildPricingQuote({ ...policy, economics }, f.client, () => clock),
  ).rejects.toMatchObject({ code: "COMPARISON_STALE" });
  const result = await buildPricingQuote(
    { ...policy, economics },
    fixture().client,
    () => now,
  );
  const expiry = new Date(now + 120_000).toISOString();
  clock = now;
  const guard = pricingFreshnessGuard(result.proof, expiry, () => clock);
  expect(guard).not.toThrow();
  clock = now + 60_000;
  expect(guard).toThrow("expired before sending");
  expect(
    pricingFreshnessGuard(
      { ...result.proof, observedAt: new Date(now + 6000).toISOString() },
      expiry,
      () => now,
    ),
  ).toThrow("expired before sending");
  expect(
    pricingFreshnessGuard(result.proof, new Date(now).toISOString(), () => now),
  ).toThrow("approved quote expired");
});

function validationAdmin(
  quote: object,
  savedPolicy: object = { ...policy, economics },
) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: table === "repricing_quotes" ? quote : savedPolicy,
              error: null,
            }),
          }),
        }),
      };
    },
  } as unknown as NonNullable<
    Parameters<typeof validateQuoteBeforeWrite>[1]
  >["admin"];
}

it("rejects an expired approved quote before network and refreshes evidence only within its original lifecycle", async () => {
  const fresh = await buildPricingQuote(
    { ...policy, economics },
    fixture().client,
    () => now,
  );
  const stored = {
    id: ownId,
    policy_id: policy.id,
    policy_version: policy.version,
    amount: fresh.amount,
    currency: fresh.currency,
    before_snapshot: fresh.before,
    proof: fresh.proof,
    expires_at: new Date(now + 120_000).toISOString(),
  };
  const f = fixture();
  await expect(
    validateQuoteBeforeWrite(ownId, {
      admin: validationAdmin({
        ...stored,
        expires_at: new Date(now).toISOString(),
      }),
      client: f.client,
      now: () => now,
    }),
  ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  expect(f.read).not.toHaveBeenCalled();
  let clock = now + 90_000;
  const validation = await validateQuoteBeforeWrite(ownId, {
    admin: validationAdmin(stored),
    client: f.client,
    now: () => clock,
  });
  expect(validation.proof.observedAt).toBe(new Date(clock).toISOString());
  expect(validation.assertFresh).not.toThrow();
  clock = now + 120_000;
  expect(validation.assertFresh).toThrow("approved quote expired");
});
