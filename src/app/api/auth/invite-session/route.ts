import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .union([
        z
          .object({
            kind: z.literal("hash"),
            tokenHash: z.string().min(1).max(8192),
          })
          .strict(),
        z
          .object({
            kind: z.literal("session"),
            accessToken: z.string().min(1).max(16384),
            refreshToken: z.string().min(1).max(8192),
          })
          .strict(),
      ])
      .parse(await readBody(request));
    const db = await supabaseServer();
    const result =
      input.kind === "hash"
        ? await db.auth.verifyOtp({
            type: "invite",
            token_hash: input.tokenHash,
          })
        : await db.auth.setSession({
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
          });
    if (result.error)
      throw new AppError(
        "INVITATION_INVALID",
        "This invitation is invalid or expired. Ask the Owner for a new invitation.",
        401,
      );
    const {
      data: { user },
      error,
    } = await db.auth.getUser();
    if (error || !user)
      throw new AppError(
        "INVITATION_INVALID",
        "This invitation could not be verified.",
        401,
      );
    const { data: member, error: membershipError } = await db
      .from("users")
      .select("active")
      .eq("id", user.id)
      .maybeSingle();
    if (membershipError || !member?.active) {
      await db.auth.signOut({ scope: "local" });
      throw new AppError(
        "STAFF_ACCESS_REQUIRED",
        "The invitation has no active staff membership. Contact the Owner.",
        403,
      );
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
