import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { password } = z
      .object({ password: z.string().min(14).max(128) })
      .parse(await readBody(request));
    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      throw new AppError(
        "UNAUTHENTICATED",
        "A valid invitation session is required.",
        401,
      );
    const { data: profile } = await db
      .from("users")
      .select("active")
      .eq("id", user.id)
      .single();
    if (!profile?.active)
      throw new AppError("FORBIDDEN", "Staff membership required.", 403);
    const { error } = await db.auth.updateUser({ password });
    if (error)
      throw new AppError(
        "PASSWORD_REJECTED",
        "The password could not be updated.",
        400,
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
