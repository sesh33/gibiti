import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { buildPricingQuote, persistQuote } from "@/domains/pricing/quotes";
import type { PricingPolicy } from "@/domains/pricing/models";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.update_price");
    if (!staff.permissions.has("offers.read"))
      throw new AppError("FORBIDDEN", "Offer access is required.", 403);
    const { policyId } = z
      .object({ policyId: z.uuid() })
      .strict()
      .parse(await readBody(request));
    const { data: policy, error } = await staff.db
      .from("repricing_policies")
      .select("*")
      .eq("id", policyId)
      .single();
    if (error || !policy)
      throw new AppError(
        "NOT_FOUND",
        "Configure a floor before simulating this listing.",
        404,
      );
    const { data: allowed, error: rateError } = await staff.db.rpc(
      "consume_rate_limit",
      { bucket: "marketplace.comparison", max_hits: 10, window_seconds: 60 },
    );
    if (rateError || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before checking the market again.",
        429,
      );
    const result = await buildPricingQuote(policy as PricingPolicy);
    const quote = await persistQuote(
      policy as PricingPolicy,
      staff.user.id,
      result,
    );
    return NextResponse.json(
      {
        quote,
        upstreamWrites: false,
        noChange: result.amount === result.before.price,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
