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
    const staff = await requireStaff("offers.read"),
      id = z.uuid().parse((await params).id);
    const input = z
      .object({
        reason: z.string().trim().min(10).max(2000),
        idempotencyKey: z.uuid(),
        confirm: z.literal(true),
      })
      .strict()
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("request_offer_batch", {
      preview_id: id,
      justification: input.reason,
      idempotency: input.idempotencyKey,
    });
    if (error)
      throw new AppError(
        "BATCH_REQUEST_REJECTED",
        "The preview expired, a listing changed or a permission/floor conflicts. No partial ticket set was created. Recover an identical request with the same key.",
        409,
      );
    return NextResponse.json(
      {
        ...data,
        message:
          "Requests recorded. Each listing requires independent review and explicit execution. No marketplace write was sent.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
