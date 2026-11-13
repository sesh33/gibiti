import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { readSellerHealth } from "@/domains/eldorado/health";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("settings.manage");
    if (staff.profile.role !== "OWNER")
      throw new AppError(
        "FORBIDDEN",
        "Only the Owner can check seller account status.",
        403,
      );
    z.object({})
      .strict()
      .parse(await readBody(request));
    const { data: allowed, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "integration.health",
      max_hits: 3,
      window_seconds: 60,
    });
    if (error || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait a minute before checking again.",
        429,
      );
    return NextResponse.json(await readSellerHealth(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
