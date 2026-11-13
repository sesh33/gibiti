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
    const staff = await requireStaff("offers.update_price"),
      id = z.uuid().parse((await params).id),
      input = z
        .object({
          reason: z.string().trim().min(10).max(2000),
          idempotencyKey: z.uuid(),
          confirm: z.literal(true),
        })
        .strict()
        .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("request_quoted_repricing", {
      quote_id: id,
      justification: input.reason,
      request_key: input.idempotencyKey,
    });
    if (error)
      throw new AppError(
        "QUOTE_REQUEST_REJECTED",
        "The quote expired or its manual pricing policy changed. Simulate again before requesting review.",
        409,
      );
    return NextResponse.json(
      {
        id: data,
        message:
          "Quoted change requested. Independent approval and a fresh market check are required before execution.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
