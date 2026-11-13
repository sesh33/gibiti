import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/domains/authentication/session";
import { EldoradoClient, resetEldoradoClient } from "@/domains/eldorado/client";
import {
  encryptSellerSecret,
  sellerClientId,
  sellerConnectionStatus,
} from "@/domains/eldorado/credentials";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";

export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
async function owner() {
  const staff = await requireStaff("settings.manage");
  if (staff.profile.role !== "OWNER")
    throw new AppError(
      "FORBIDDEN",
      "Only the Owner can configure integrations.",
      403,
    );
  return staff;
}
export async function GET() {
  try {
    await owner();
    return NextResponse.json(await sellerConnectionStatus(), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const staff = await owner();
    const { clientSecret } = z
      .object({ clientSecret: z.string().min(10).max(512).regex(/^\S+$/) })
      .strict()
      .parse(await readBody(request));
    const { data: allowed, error: rateError } = await staff.db.rpc(
      "consume_rate_limit",
      { bucket: "integration.connect", max_hits: 3, window_seconds: 60 },
    );
    if (rateError || !allowed)
      throw new AppError(
        "RATE_LIMITED",
        "Wait a minute before checking the connection again.",
        429,
      );
    const clientId = sellerClientId();
    // Validate encryption before contacting upstream. Only the official read
    // contract is tested; connection setup never changes listings or orders.
    const encrypted = encryptSellerSecret(clientSecret, clientId);
    const client = new EldoradoClient({ clientId, clientSecret });
    await client.orders();
    const admin = supabaseAdmin();
    const { error } = await admin.rpc("save_seller_credentials", {
      credential_client_id: clientId,
      credential_envelope: encrypted,
      actor: staff.user.id,
      actor_session: staff.sessionId,
    });
    if (error)
      throw new AppError(
        "INTEGRATION_SAVE_FAILED",
        "The connection was checked but could not be saved. Sign in again and retry.",
        503,
      );
    resetEldoradoClient();
    return NextResponse.json(
      {
        ok: true,
        configured: true,
        message: "Connected. You can now synchronize orders and offers.",
      },
      { headers },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
