import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { readSellerOverview } from "@/domains/eldorado/seller-tools";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function GET() {
  try {
    const staff = await requireStaff("seller.read");
    const { data, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "seller.read",
      max_hits: 3,
      window_seconds: 60,
    });
    if (error || !data)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before refreshing Seller diagnostics.",
        429,
      );
    return NextResponse.json(await readSellerOverview(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
