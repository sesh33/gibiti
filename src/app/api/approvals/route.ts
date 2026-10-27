import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET() {
  try {
    const staff = await requireStaff();
    const { data, error } = await staff.db
      .from("approval_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error)
      throw new AppError("QUERY_FAILED", "Approvals could not be loaded.", 500);
    return NextResponse.json(
      { items: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff();
    const input = z
      .object({
        action: z.enum([
          "orders.deliver",
          "orders.cancel",
          "orders.update_delivery",
          "offers.delete",
          "offers.update_price",
          "inventory.manage",
        ]),
        target: z.string().min(1).max(100),
        reason: z.string().trim().min(10).max(2000),
        idempotencyKey: z.uuid(),
      })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("request_approval", {
      operation: input.action,
      target: input.target,
      justification: input.reason,
      request_key: input.idempotencyKey,
    });
    if (error)
      throw new AppError(
        "APPROVAL_REJECTED",
        "The request conflicts with an existing approval or is not permitted.",
        409,
      );
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
