import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import {
  loadMarketTicket,
  executeMarketTicket,
  operationDependencies,
} from "@/domains/eldorado/operations";
import { requiredChangePermissions } from "@/domains/eldorado/contracts";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff();
    const input = z
      .object({ mode: z.enum(["execute", "check"]), confirm: z.literal(true) })
      .strict()
      .parse(await readBody(request));
    const ticket = await loadMarketTicket((await params).id, staff);
    if (input.mode === "execute" && ticket.payload.automaticPolicyId)
      throw new AppError(
        "AUTOMATIC_SERVICE_TICKET",
        "This scoped automatic ticket belongs to the hosted runner. Use Check outcome, or request a separate manual change.",
        409,
      );
    if (
      !requiredChangePermissions(ticket.payload.change.kind).every(
        (permission) => staff.permissions.has(permission),
      )
    )
      throw new AppError("FORBIDDEN", "This operation is not permitted.", 403);
    if (
      input.mode === "execute" &&
      ![ticket.requester_id, ticket.approver_id].includes(staff.user.id)
    )
      throw new AppError(
        "FORBIDDEN",
        "Only the requester or approver can execute this operation.",
        403,
      );
    const { data: allowed, error } = await staff.db.rpc("consume_rate_limit", {
      bucket: "marketplace.execute",
      max_hits: 10,
      window_seconds: 60,
    });
    if (error || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before checking another operation.",
        429,
      );
    const result = await executeMarketTicket(
      ticket,
      operationDependencies(ticket, staff),
      input.mode === "check",
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
