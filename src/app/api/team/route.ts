import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
import {
  provisionStaffInvitation,
  staffInvitationDependencies,
  staffInvitationInput,
} from "@/domains/authentication/staff-invitations";
export async function GET() {
  try {
    const staff = await requireStaff("team.read");
    const { data, error } = await staff.db
      .from("users")
      .select(
        "id,email,display_name,role,role_label,active,created_at,user_permission_overrides(permission,allowed)",
      )
      .order("created_at");
    if (error)
      throw new AppError("QUERY_FAILED", "Staff could not be loaded.", 500);
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
    const staff = await requireStaff("team.invite");
    if (staff.profile.role !== "OWNER")
      throw new AppError(
        "FORBIDDEN",
        "Only the Owner can issue role-bearing invitations.",
        403,
      );
    const input = staffInvitationInput.parse(await readBody(request));
    const { data: allowed, error: rateError } = await staff.db.rpc(
      "consume_rate_limit",
      { bucket: "team.invite", max_hits: 10, window_seconds: 60 },
    );
    if (rateError || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait before sending more invitations.",
        429,
      );
    const result = await provisionStaffInvitation(
      {
        id: staff.user.id,
        role: staff.profile.role,
        permissions: staff.permissions,
      },
      input,
      staffInvitationDependencies(
        supabaseAdmin(),
        process.env.APP_ORIGIN || "",
      ),
    );
    return NextResponse.json(
      { ok: true, ...result },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
