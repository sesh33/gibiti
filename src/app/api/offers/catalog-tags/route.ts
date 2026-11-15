import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { catalogTagsInput } from "@/domains/offers/catalog";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("offers.create", true);
    if (!staff.permissions.has("offers.read"))
      throw new AppError("FORBIDDEN", "Listing access is required.", 403);
    const input = catalogTagsInput.parse(await readBody(request));
    const { data: allowed, error: budgetError } = await staff.db.rpc(
      "consume_rate_limit",
      { bucket: "offers.catalog_labels", max_hits: 30, window_seconds: 60 },
    );
    if (budgetError || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before changing more catalog labels.",
        429,
      );
    const { error } = await staff.db.rpc("save_offer_catalog_tags", {
      offer_id: input.offerId,
      region: input.region,
      platform: input.platform,
      denomination: input.denomination,
    });
    if (error)
      throw new AppError(
        "CATALOG_LABELS_NOT_SAVED",
        "Local labels could not be saved. Verify catalog permissions, MFA and the database migration.",
        409,
      );
    return NextResponse.json(
      {
        message: "Local catalog labels saved. Eldorado was not changed.",
        upstreamWrites: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
