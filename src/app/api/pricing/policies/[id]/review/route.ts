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
          version: z.uuid(),
          approve: z.boolean(),
          reason: z.string().trim().min(3).max(2000),
        })
        .strict()
        .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("review_repricing_policy", {
      target: id,
      expected_version: input.version,
      approve: input.approve,
      justification: input.reason,
    });
    if (error)
      throw new AppError(
        "POLICY_REVIEW_REJECTED",
        "A different authorized MFA reviewer must review the current policy version.",
        409,
      );
    return NextResponse.json(
      { policy: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
