import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/http";
import { supabaseServer } from "@/lib/supabase/server";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const db = await supabaseServer();
    const {
      data: { user },
      error: identityError,
    } = await db.auth.getUser();
    if (identityError || !user) {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error)
        throw new AppError(
          "LOGOUT_FAILED",
          "The session could not be cleared. Try again.",
          503,
        );
      return NextResponse.json({ ok: true });
    }
    const { error: revokeError } = await db.rpc("revoke_own_employee_session");
    if (revokeError)
      throw new AppError(
        "SESSION_REVOCATION_FAILED",
        "Session revocation could not be confirmed. Try again before leaving this device.",
        503,
      );
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error)
      throw new AppError(
        "LOGOUT_FAILED",
        "The staff session was revoked, but clearing the authentication session failed. Retry sign out.",
        503,
      );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
