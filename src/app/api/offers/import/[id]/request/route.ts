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
    const staff = await requireStaff("offers.create", true),
      id = z.uuid().parse((await params).id);
    const input = z
      .object({
        rowIndex: z.number().int().min(0).max(9),
        reason: z.string().trim().min(10).max(2000),
        idempotencyKey: z.uuid(),
        confirm: z.literal(true),
      })
      .strict()
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("request_offer_import_row", {
      preview_id: id,
      row_index: input.rowIndex,
      justification: input.reason,
      idempotency: input.idempotencyKey,
    });
    if (error)
      throw new AppError(
        "IMPORT_REQUEST_REJECTED",
        "The preview expired, access changed, or another creation needs resolution. No marketplace write was sent. Check Approvals, then retry the identical request key to recover an accepted request.",
        409,
      );
    return NextResponse.json(
      {
        ...data,
        message:
          "Creation request recorded. Independent review and explicit execution are required; no marketplace write was sent.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
