import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("conversations.assign");
    const target = z.uuid().parse((await params).id);
    const { employee } = z
      .object({ employee: z.uuid() })
      .parse(await readBody(request));
    const { error } = await staff.db.rpc("assign_order", { target, employee });
    if (error)
      throw new AppError(
        "ASSIGNMENT_REJECTED",
        "This order could not be assigned.",
        403,
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
