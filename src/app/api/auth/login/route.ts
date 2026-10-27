import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = z
      .object({ email: z.email(), password: z.string().min(8).max(128) })
      .parse(await readBody(request));
    const db = await supabaseServer();
    const { data, error } = await db.auth.signInWithPassword(body);
    if (error || !data.user)
      throw new AppError(
        "LOGIN_FAILED",
        "The email or password was not accepted.",
        401,
      );
    const { data: profile, error: profileError } = await db
      .from("users")
      .select("role,active")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError || !profile?.active) {
      await db.auth.signOut({ scope: "local" });
      if (profileError)
        throw new AppError(
          "SCHEMA_REQUIRED",
          "The staff database could not be verified. Apply the workspace migrations or check database connectivity.",
          503,
        );
      throw new AppError(
        "STAFF_ACCESS_REQUIRED",
        "This account has no active staff membership. Complete first Owner setup or contact your administrator.",
        403,
      );
    }
    const { data: assurance, error: assuranceError } =
      await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) {
      await db.auth.signOut({ scope: "local" });
      throw new AppError(
        "SESSION_INVALID",
        "Session assurance could not be verified.",
        401,
      );
    }
    const { data: registered, error: registrationError } = await db.rpc(
      "register_employee_session",
    );
    if (registrationError || !registered) {
      await db.auth.signOut({ scope: "local" });
      throw new AppError(
        "SESSION_REVOKED",
        "Your staff session is inactive or revoked.",
        403,
      );
    }
    return NextResponse.json(
      {
        ok: true,
        next:
          (profile.role === "OWNER" || profile.role === "ADMIN") &&
          assurance?.currentLevel !== "aal2"
            ? "/mfa"
            : "/inbox",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
