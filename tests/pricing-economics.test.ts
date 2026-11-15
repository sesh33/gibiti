import { expect, it } from "vitest";
import {
  checkEconomics,
  economicFloor,
  estimateEconomics,
} from "@/domains/pricing/economics";
import {
  economicsInput,
  policyInput,
  type PricingEconomics,
} from "@/domains/pricing/models";

const now = Date.parse("2026-11-15T12:00:00Z");
const basis: PricingEconomics = {
  unitCost: 1,
  feePercent: 10,
  fixedFee: 0.5,
  comparisonQuantity: 5,
  minMarginPercent: 20,
  verifiedAt: "2026-11-15T11:00:00Z",
  validUntil: "2026-11-16T11:00:00Z",
};

it("calculates basket fees, estimated net revenue and gross-price margin without a financial API", () => {
  const result = estimateEconomics(basis, 2);
  expect(result).toMatchObject({
    source: "owner-estimate",
    comparisonQuantity: 5,
    grossRevenue: 10,
    fees: 1.5,
    netRevenue: 8.5,
    totalCost: 5,
    profit: 3.5,
    marginPercent: 35,
  });
  expect(economicFloor(basis)).toBeCloseTo(1.1 / 0.7, 12);
  expect(
    estimateEconomics(basis, economicFloor(basis)).marginPercent,
  ).toBeCloseTo(20, 10);
});

it("validates explicit bounded assumptions and rejects impossible or unrecognized economics", () => {
  expect(economicsInput.safeParse(basis).success).toBe(true);
  for (const change of [
    { unitCost: -1 },
    { fixedFee: Infinity },
    { unitCost: 1e12 + 1 },
    { fixedFee: 1e12 + 1 },
    { feePercent: 80, minMarginPercent: 20 },
    { comparisonQuantity: 0 },
    { comparisonQuantity: 1.5 },
    { comparisonQuantity: 2147483648 },
    { validUntil: basis.verifiedAt },
    { validUntil: "2026-12-16T11:00:00Z" },
    { feeFromEldorado: true },
  ])
    expect(economicsInput.safeParse({ ...basis, ...change }).success).toBe(
      false,
    );
});

it("blocks missing, expired and future-verified inputs with a bounded clock tolerance", () => {
  expect(checkEconomics(null, now).ok).toBe(false);
  expect(
    checkEconomics({ ...basis, validUntil: "2026-11-15T12:00:00Z" }, now).ok,
  ).toBe(false);
  expect(
    checkEconomics({ ...basis, verifiedAt: "2026-11-15T12:00:06Z" }, now).ok,
  ).toBe(false);
  expect(
    checkEconomics({ ...basis, verifiedAt: "2026-11-15T12:00:05Z" }, now).ok,
  ).toBe(true);
  expect(checkEconomics(basis, now).ok).toBe(true);
});

it("keeps legacy saves simulation-safe while requiring exact economics schema when supplied", () => {
  const policy = {
    offerId: "predefined:11111111-1111-4111-8111-111111111111",
    floor: 1,
    difference: 0.01,
    decimals: 2,
  };
  expect(policyInput.parse(policy).economics).toBeNull();
  expect(policyInput.parse({ ...policy, economics: basis }).economics).toEqual(
    basis,
  );
  expect(
    policyInput.safeParse({
      ...policy,
      economics: { ...basis, currency: "EUR" },
    }).success,
  ).toBe(false);
});
