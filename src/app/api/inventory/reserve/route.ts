import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("inventory.manage");
    const body = z
      .object({ item: z.uuid(), order: z.uuid() })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("reserve_inventory", {
      item: body.item,
      target_order: body.order,
    });
    if (error)
      throw new AppError(
        "RESERVATION_CONFLICT",
        "The item is unavailable or this order is not accessible.",
        409,
      );
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
