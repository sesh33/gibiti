import { NextResponse } from "next/server";
import { z } from "zod";
import { permissions, roles } from "@/domains/authorization/permissions";
import { requireStaff } from "@/domains/authentication/session";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("team.manage_permissions");
    const target = z.uuid().parse((await params).id);
    const body = z
      .object({
        role: z.enum(roles),
        active: z.boolean(),
        reason: z.string().trim().min(10).max(2000),
        idempotencyKey: z.uuid(),
        overrides: z
          .array(
            z.object({ permission: z.enum(permissions), allowed: z.boolean() }),
          )
          .max(permissions.length),
      })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("request_staff_access_change", {
      target,
      new_role: body.role,
      new_active: body.active,
      overrides: body.overrides,
      justification: body.reason,
      request_key: body.idempotencyKey,
    });
    if (error)
      throw new AppError(
        "STAFF_CHANGE_REJECTED",
        "You cannot modify this employee or your own permissions.",
        403,
      );
    return NextResponse.json({ id: data, executed: false });
  } catch (error) {
    return errorResponse(error);
  }
}
