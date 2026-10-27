import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = z
      .object({ email: z.email(), password: z.string().min(8).max(256) })
      .parse(await readBody(request));
    const db = await supabaseServer();
    const { error } = await db.auth.signInWithPassword(body);
    if (error)
      throw new AppError(
        "LOGIN_FAILED",
        "The email or password was not accepted.",
        401,
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
