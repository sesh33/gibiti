import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { readNotifications } from "@/domains/eldorado/seller-tools";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const staff = await requireStaff("notifications.read");
    const input = z
      .object({ cursor: z.string().min(1).max(2000).optional() })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { data, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "notifications.read",
      max_hits: 10,
      window_seconds: 60,
    });
    if (error || !data)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before reading another notification page.",
        429,
      );
    return NextResponse.json(await readNotifications(input.cursor), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
