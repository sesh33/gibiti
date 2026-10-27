import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Sign in first.", 401);
    const { data: profile } = await db
      .from("users")
      .select("active")
      .eq("id", user.id)
      .single();
    if (!profile?.active)
      throw new AppError(
        "FORBIDDEN",
        "An active staff account is required.",
        403,
      );
    const body = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("setup") }),
        z.object({
          action: z.literal("verify"),
          factorId: z.uuid(),
          code: z.string().regex(/^\d{6}$/),
        }),
      ])
      .parse(await readBody(request));
    if (body.action === "setup") {
      const { data: factors, error } = await db.auth.mfa.listFactors();
      if (error)
        throw new AppError(
          "MFA_ERROR",
          "Could not load authentication factors.",
          502,
        );
      const factor = factors.totp.find((item) => item.status === "verified");
      if (factor) return NextResponse.json({ factorId: factor.id });
      // Reuse the friendly name after clearing only this user's unverified enrollment.
      for (const stale of factors.all.filter(
        (item) => item.factor_type === "totp" && item.status === "unverified",
      ))
        await db.auth.mfa.unenroll({ factorId: stale.id });
      const { data, error: enrollError } = await db.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "RIVOX Control",
      });
      if (enrollError)
        throw new AppError(
          "MFA_ERROR",
          "Could not enroll an authenticator.",
          502,
        );
      return NextResponse.json(
        { factorId: data.id, qrCode: data.totp.qr_code },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data: challenge, error: challengeError } =
      await db.auth.mfa.challenge({ factorId: body.factorId });
    if (challengeError)
      throw new AppError("MFA_ERROR", "Could not challenge this factor.", 400);
    const { error } = await db.auth.mfa.verify({
      factorId: body.factorId,
      challengeId: challenge.id,
      code: body.code,
    });
    if (error)
      throw new AppError(
        "MFA_INVALID",
        "The verification code was not accepted.",
        400,
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
