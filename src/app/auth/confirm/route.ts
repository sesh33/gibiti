import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token_hash");
  if (token) {
    const db = await supabaseServer();
    const { error } = await db.auth.verifyOtp({
      type: "invite",
      token_hash: token,
    });
    if (!error)
      return NextResponse.redirect(new URL("/account/setup", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=invite", request.url));
}
