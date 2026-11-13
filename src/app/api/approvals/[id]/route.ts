import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff();
    const target = z.uuid().parse((await params).id);
    const body = z
      .object({
        approve: z.boolean(),
        reason: z.string().trim().min(3).max(2000),
      })
      .parse(await readBody(request));
    const { error } = await staff.db.rpc("decide_approval", {
      target,
      approve: body.approve,
      justification: body.reason,
    });
    if (error)
      throw new AppError(
        "DECISION_REJECTED",
        "This decision is not allowed or has already been recorded.",
        409,
      );
    const { data } = await staff.db
      .from("approval_requests")
      .select("status,payload")
      .eq("id", target)
      .single();
    return NextResponse.json({
      ok: true,
      executed: data?.status === "succeeded",
      message:
        data?.status === "succeeded"
          ? "Approved internal operation applied. Review the audit log for its result."
          : data?.status === "approved" && data.payload?.marketV1
            ? "Approved. An authorized participant can execute this exact request once from Approvals."
            : "Decision recorded. This request has no enabled external executor.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
