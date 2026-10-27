import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { synchronizeOrders } from "@/domains/orders/service";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("orders.read");
    const { cursor } = z
      .object({ cursor: z.string().max(2000).optional() })
      .parse(await readBody(request));
    const { data: allowed, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "orders.sync",
      max_hits: 20,
      window_seconds: 60,
    });
    if (error || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before synchronizing another page.",
        429,
      );
    return NextResponse.json(
      await synchronizeOrders(staff.user.id, staff.sessionId, cursor),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
