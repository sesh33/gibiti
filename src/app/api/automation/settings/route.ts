import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { workspacePreferenceInput } from "@/domains/pricing/models";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sellerConnectionStatus } from "@/domains/eldorado/credentials";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function GET() {
  try {
    const staff = await requireStaff();
    const { data, error } = await staff.db
      .from("workspace_preferences")
      .select(
        "poll_enabled,poll_seconds,auto_delivery_enabled,auto_pricing_enabled,updated_at",
      )
      .eq("id", true)
      .single();
    if (error)
      throw new AppError(
        "AUTOMATION_SETTINGS_UNAVAILABLE",
        "Workspace preferences could not be loaded.",
        503,
      );
    let runtime = null;
    if (
      staff.permissions.has("settings.manage") ||
      staff.permissions.has("offers.update_price")
    ) {
      const result = await supabaseAdmin()
        .from("automation_runtime")
        .select(
          "scheduler_configured,last_heartbeat_at,last_poll_at,last_error_code,backoff_until",
        )
        .eq("id", true)
        .single();
      if (!result.error) runtime = result.data;
    }
    const connection = await sellerConnectionStatus();
    return NextResponse.json(
      {
        settings: {
          pollEnabled: data.poll_enabled,
          pollSeconds: data.poll_seconds,
          autoDeliveryEnabled: data.auto_delivery_enabled,
          autoPricingEnabled: data.auto_pricing_enabled,
        },
        runtime,
        connection: {
          configured: connection.configured,
          verifiedAt: connection.verifiedAt,
          verifiedOrigin: connection.verifiedOrigin,
          verifiedOnThisServer:
            connection.configured &&
            connection.verifiedOrigin === process.env.APP_ORIGIN,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff("settings.manage");
    if (staff.profile.role !== "OWNER")
      throw new AppError(
        "FORBIDDEN",
        "Only the Owner can authorize background operation.",
        403,
      );
    const input = workspacePreferenceInput.parse(await readBody(request));
    const { data, error } = await staff.db.rpc("save_workspace_preferences", {
      polling: input.pollEnabled,
      seconds: input.pollSeconds,
      auto_delivery: input.autoDeliveryEnabled,
      auto_pricing: input.autoPricingEnabled,
      activation_confirmed: input.confirmAutomation,
    });
    if (error)
      throw new AppError(
        "AUTOMATION_SETTINGS_REJECTED",
        error.code === "55000"
          ? "Verify the saved Eldorado connection from this hosted server and check that its scheduler is configured before enabling background traffic."
          : "Check MFA and explicitly authorize any automatic mode before saving.",
        409,
      );
    await supabaseAdmin().rpc("cancel_stale_automatic_tickets");
    return NextResponse.json(
      { ok: true, settings: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
