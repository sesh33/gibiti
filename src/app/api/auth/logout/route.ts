import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/http";
import { supabaseServer } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const db = await supabaseServer();
    await db.rpc("revoke_staff_sessions", {
      target: (await db.auth.getUser()).data.user?.id,
    });
    await db.auth.signOut({ scope: "local" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
