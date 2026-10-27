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
    const staff = await requireStaff("conversations.internal_notes");
    const target = z.uuid().parse((await params).id);
    const { body } = z
      .object({ body: z.string().trim().min(1).max(5000) })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("add_internal_note", {
      target,
      note: body,
    });
    if (error)
      throw new AppError(
        "NOTE_REJECTED",
        "The note could not be saved for this order.",
        403,
      );
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
