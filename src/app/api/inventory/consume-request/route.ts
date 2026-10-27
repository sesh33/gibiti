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
        reason: z.string().trim().min(10).max(2000),
        idempotencyKey: z.uuid(),
      })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc(
      "request_inventory_consumption",
      {
        reservation: input.reservation,
        justification: input.reason,
        request_key: input.idempotencyKey,
      },
    );
    if (error)
      throw new AppError(
        "REQUEST_REJECTED",
        "The reservation is unavailable or already has a pending request.",
        409,
      );
    return NextResponse.json({ id: data, executed: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
