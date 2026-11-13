import { NextResponse } from "next/server";
import { requireStaff } from "@/domains/authentication/session";
import { staffPreferenceInput } from "@/domains/pricing/models";
import { readBody, requireSameOrigin } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
function view(
  data: { order_poll_enabled: boolean; order_poll_seconds: number } | null,
) {
  return {
    orderPollingEnabled: data?.order_poll_enabled ?? false,
    orderPollingSeconds: data?.order_poll_seconds ?? 60,
  };
}
export async function GET() {
  try {
    const staff = await requireStaff();
    const { data, error } = await staff.db
      .from("staff_preferences")
      .select("order_poll_enabled,order_poll_seconds")
      .eq("user_id", staff.user.id)
      .maybeSingle();
    if (error)
      throw new AppError(
        "PREFERENCES_UNAVAILABLE",
        "Saved preferences could not be loaded.",
        503,
      );
    return NextResponse.json(view(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await requireStaff(),
      input = staffPreferenceInput.parse(await readBody(request));
    const { data, error } = await staff.db.rpc("save_staff_preferences", {
      enabled: input.orderPollingEnabled,
      seconds: input.orderPollingSeconds,
    });
    if (error)
      throw new AppError(
        "PREFERENCES_SAVE_FAILED",
        "Preferences could not be saved.",
        409,
      );
    return NextResponse.json(view(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
