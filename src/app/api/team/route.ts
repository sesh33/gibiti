import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET() {
  try {
    const staff = await requireStaff("team.read");
    const { data, error } = await staff.db
      .from("users")
      .select(
        "id,email,display_name,role,active,created_at,user_permission_overrides(permission,allowed)",
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
    const input = z
      .object({
        email: z.email(),
        name: z.string().trim().min(1).max(100),
        role: z.enum([
          "ADMIN",
          "SUPERVISOR",
          "SUPPORT_AGENT",
          "FULFILLMENT_AGENT",
          "VIEWER",
        ]),
      })
      .parse(await readBody(request));
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
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      input.email,
      { redirectTo: new URL("/account/setup", process.env.APP_ORIGIN!).href },
    );
    if (error || !data.user)
      throw new AppError(
        "INVITATION_FAILED",
        "The invitation could not be sent. Check email delivery and existing membership.",
        502,
      );
    const { error: profileError } = await admin
      .from("users")
      .insert({
        id: data.user.id,
        email: input.email,
        display_name: input.name,
        role: input.role,
      });
    if (profileError) {
      await admin
        .from("integration_errors")
        .insert({ provider: "supabase-auth", code: "INVITE_PROFILE_FAILED" });
      throw new AppError(
        "INVITATION_INCOMPLETE",
        "The email was sent, but membership was not created. The invited account has no workspace access; an administrator must reconcile it.",
        500,
      );
    }
    const { error: auditError } = await admin
      .from("audit_logs")
      .insert({
        actor_id: staff.user.id,
        action: "staff.invited",
        target_type: "user",
        target_id: data.user.id,
        metadata: { role: input.role },
      });
    if (auditError)
      throw new AppError(
        "AUDIT_FAILED",
        "Invitation created, but audit recording failed. Contact the Owner before retrying.",
        500,
      );
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
