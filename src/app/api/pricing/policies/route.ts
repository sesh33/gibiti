import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { policyInput } from "@/domains/pricing/models";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { eldoradoClient } from "@/domains/eldorado/client";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const staff = await requireStaff("offers.update_price");
    if (!staff.permissions.has("offers.read"))
      throw new AppError("FORBIDDEN", "Offer access is required.", 403);
    const target = new URL(request.url).searchParams.get("offerId");
    let query = staff.db
      .from("repricing_policies")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (target) query = query.eq("offer_id", target);
    const { data, error } = await query;
    if (error)
      throw new AppError(
        "POLICIES_UNAVAILABLE",
        "Pricing rules could not be loaded.",
        503,
      );
    return NextResponse.json(
      { items: data ?? [] },
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
        "Only the Owner can configure price authority.",
        403,
      );
    const input = policyInput.parse(await readBody(request));
    const snapshot = await eldoradoClient().predefinedSnapshot(
      input.offerId.replace(/^predefined:/, ""),
    );
    const { data: local, error: localError } = await staff.db
      .from("offers")
      .select("currency")
      .eq("id", input.offerId)
      .single();
    if (localError || !local || local.currency !== snapshot.currency)
      throw new AppError(
        "POLICY_CURRENCY_CHANGED",
        "Synchronize the listing's actual currency before saving a floor.",
        409,
      );
    const { data, error } = await staff.db.rpc("save_repricing_policy", {
      target: input.offerId,
      desired_floor: input.floor,
      desired_difference: input.difference,
      desired_decimals: input.decimals,
      desired_mode: input.mode,
      seconds: input.intervalSeconds,
      activation_confirmed: input.confirmAutomatic,
    });
    if (error)
      throw new AppError(
        "POLICY_SAVE_REJECTED",
        "The rule could not be saved. Check MFA, automatic confirmation and unresolved operations.",
        409,
      );
    await supabaseAdmin().rpc("cancel_stale_automatic_tickets");
    return NextResponse.json(
      { policy: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
