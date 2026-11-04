import { NextResponse } from "next/server";
import { z } from "zod";
import { assertHostedOwnerEmailSessionAccess } from "@/domains/authentication/owner-bootstrap";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";

/** Converts Supabase's default email-link session to server cookies, without staff access. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    assertHostedOwnerEmailSessionAccess(request);
    const input = z
      .object({
        accessToken: z.string().min(1).max(16384),
        refreshToken: z.string().min(1).max(8192),
      })
      .parse(await readBody(request));
    const admin = supabaseAdmin();
    const { data: owners, error: ownerError } = await admin
      .from("users")
      .select("id")
      .eq("role", "OWNER")
      .limit(1);
    if (ownerError)
      throw new AppError(
        "SCHEMA_REQUIRED",
        "The workspace database is unavailable.",
        503,
      );
    if (owners?.length)
      throw new AppError(
        "OWNER_ALREADY_EXISTS",
        "Owner setup is complete. Sign in with your account.",
        409,
      );

    const db = await supabaseServer();
    const { error: sessionError } = await db.auth.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    });
    const { data, error: identityError } = sessionError
      ? { data: { user: null }, error: sessionError }
      : await db.auth.getUser();
    if (
      sessionError ||
      identityError ||
      !data.user?.email ||
      !data.user.email_confirmed_at
    ) {
      await db.auth.signOut({ scope: "local" }).catch(() => undefined);
      throw new AppError(
        "OWNER_EMAIL_LINK_INVALID",
        "This email verification link is invalid or expired. Return to your private setup tab and request another email.",
        401,
      );
    }
    return NextResponse.json(
      { ok: true, next: "return-to-private-setup" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
