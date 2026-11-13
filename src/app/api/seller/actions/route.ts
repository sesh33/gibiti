import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { executeSellerAction } from "@/domains/eldorado/seller-tools";
import { readBody, requireSameOrigin } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function GET() {
  try {
    const staff = await requireStaff();
    const { data, error } = await staff.db
      .from("seller_actions")
      .select(
        "id,kind,notification_id,status,error_code,reason,created_at,finished_at",
      )
      .order("created_at", { ascending: false })
      .limit(30);
    if (error)
      throw new AppError(
        "SELLER_HISTORY_UNAVAILABLE",
        "Seller action history could not be loaded.",
        503,
      );
    return NextResponse.json(
      { items: data ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff(undefined, true);
    return NextResponse.json(
      await executeSellerAction(await readBody(request), staff),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
