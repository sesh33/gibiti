import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET(request: Request) {
  try {
    const staff = await requireStaff("offers.update_price"),
      target = new URL(request.url).searchParams.get("offerId");
    let policies = staff.db.from("repricing_policies").select("id").limit(100);
    if (target) policies = policies.eq("offer_id", target);
    const { data: ids, error } = await policies;
    if (error)
      throw new AppError(
        "PRICING_HISTORY_UNAVAILABLE",
        "Pricing history could not be loaded.",
        503,
      );
    if (!ids?.length)
      return NextResponse.json(
        { items: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    const result = await staff.db
      .from("repricing_quotes")
      .select(
        "id,policy_id,policy_version,amount,currency,before_snapshot,proof,created_at,expires_at",
      )
      .in(
        "policy_id",
        ids.map((row) => row.id),
      )
      .order("created_at", { ascending: false })
      .limit(20);
    if (result.error)
      throw new AppError(
        "PRICING_HISTORY_UNAVAILABLE",
        "Pricing history could not be loaded.",
        503,
      );
    return NextResponse.json(
      { items: result.data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
