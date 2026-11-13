import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { readBody, requireSameOrigin } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("settings.manage", true),
      id = z.uuid().parse((await params).id);
    const input = z
      .object({
        reason: z.string().trim().min(20).max(2000),
        confirmedCheckedOnEldorado: z.literal(true),
      })
      .strict()
      .parse(await readBody(request));
    if (staff.profile.role !== "OWNER")
      throw new AppError(
        "FORBIDDEN",
        "Only the Owner may record this manual verification.",
        403,
      );
    const { error } = await staff.db.rpc("record_seller_manual_check", {
      operation_id: id,
      justification: input.reason,
    });
    if (error)
      throw new AppError(
        "MANUAL_CHECK_REJECTED",
        "Check the result on Eldorado and wait until its original request window ends.",
        409,
      );
    return NextResponse.json(
      {
        message:
          "Manual verification recorded. No upstream request was sent or repeated.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
