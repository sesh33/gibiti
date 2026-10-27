import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { permissions, roles } from "@/domains/authorization/permissions";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET() {
  try {
    const staff = await requireStaff("team.read");
    const { data, error } = await staff.db
      .from("role_profiles")
      .select("id,name,base_role,overrides")
      .order("name");
    if (error)
      throw new AppError(
        "QUERY_FAILED",
        "Custom roles could not be loaded. Apply the latest migrations.",
        503,
      );
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
    const staff = await requireStaff("team.manage_permissions");
    const input = z
      .object({
        name: z.string().trim().min(2).max(60),
        baseRole: z.enum(roles).refine((role) => role !== "OWNER"),
        overrides: z
          .array(
            z.object({ permission: z.enum(permissions), allowed: z.boolean() }),
          )
          .max(permissions.length),
      })
      .parse(await readBody(request));
    const { data, error } = await staff.db.rpc("create_role_profile", {
      label: input.name,
      base: input.baseRole,
      overrides: input.overrides,
    });
    if (error)
      throw new AppError(
        "ROLE_REJECTED",
        "The role name must be unique and only the Owner can create custom roles.",
        409,
      );
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
