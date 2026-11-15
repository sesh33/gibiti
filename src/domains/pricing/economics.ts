import { economicsInput, type PricingEconomics } from "./models";

export const clockToleranceMs = 5000;

export type EconomicsEstimate = {
  source: "owner-estimate";
  basis: PricingEconomics;
  comparisonQuantity: number;
  grossRevenue: number;
  fees: number;
  netRevenue: number;
  totalCost: number;
  profit: number;
  marginPercent: number;
  economicFloor: number;
};

/** Seller-entered estimates in the listing currency; no fee or balance API is assumed. */
export function economicFloor(basis: PricingEconomics): number {
  return (
    (basis.unitCost + basis.fixedFee / basis.comparisonQuantity) /
    (1 - basis.feePercent / 100 - basis.minMarginPercent / 100)
  );
}

export function estimateEconomics(
  basis: PricingEconomics,
  unitPrice: number,
): EconomicsEstimate {
  const grossRevenue = unitPrice * basis.comparisonQuantity,
    fees = (grossRevenue * basis.feePercent) / 100 + basis.fixedFee,
    netRevenue = grossRevenue - fees,
    totalCost = basis.unitCost * basis.comparisonQuantity,
    profit = netRevenue - totalCost;
  return {
    source: "owner-estimate",
    basis,
    comparisonQuantity: basis.comparisonQuantity,
    grossRevenue,
    fees,
    netRevenue,
    totalCost,
    profit,
    marginPercent: grossRevenue > 0 ? (profit / grossRevenue) * 100 : 0,
    economicFloor: economicFloor(basis),
  };
}

export function checkEconomics(
  raw: unknown,
  now = Date.now(),
):
  | { ok: true; basis: PricingEconomics; economicFloor: number }
  | { ok: false; reason: string } {
  const parsed = economicsInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      reason:
        "The Owner must save complete cost, fee, quantity and margin estimates before repricing can execute.",
    };
  const basis = parsed.data,
    verified = Date.parse(basis.verifiedAt),
    expiry = Date.parse(basis.validUntil);
  if (verified > now + clockToleranceMs)
    return {
      ok: false,
      reason: "The cost verification time is in the future.",
    };
  if (expiry <= now)
    return {
      ok: false,
      reason:
        "Cost and fee estimates expired. The Owner must verify them again.",
    };
  const floor = economicFloor(basis);
  if (!Number.isFinite(floor) || floor < 0)
    return {
      ok: false,
      reason: "The economic floor cannot be calculated safely.",
    };
  return { ok: true, basis, economicFloor: floor };
}
