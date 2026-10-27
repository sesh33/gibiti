import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("inventory.manage");
    const input = z
      .object({
        reservation: z.uuid(),
        consume: z.boolean(),
        reason: z.string().trim().min(3).max(2000),
      })
      .parse(await readBody(request));
    const { error } = await staff.db.rpc("finish_inventory_reservation", {
      reservation: input.reservation,
      consume: input.consume,
      justification: input.reason,
    });
    if (error)
      throw new AppError(
        "RESERVATION_REJECTED",
        "The reservation is no longer available or the operation is not allowed.",
        409,
      );
    return NextResponse.json({ ok: true, externalOrderChanged: false });
  } catch (error) {
    return errorResponse(error);
  }
}
