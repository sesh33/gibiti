import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
import {
  assertOwnerSetupAccess,
  completeOwnerBootstrap,
  localSupabaseAccountCreationAllowed,
} from "@/domains/authentication/owner-bootstrap";

let completed = false;
let windowStartedAt = 0;
let attempts = 0;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = z
      .object({
        token: z.string().min(1).max(256),
        email: z.email().max(254),
        password: z.string().min(8).max(128),
        name: z.string().trim().min(1).max(100),
        confirm: z.literal(true),
        accountMode: z.enum(["existing", "create-local"]).default("existing"),
      })
      .superRefine((input, context) => {
        if (input.accountMode === "create-local" && input.password.length < 14)
          context.addIssue({
            code: "custom",
            path: ["password"],
            message: "Use at least 14 characters for a new account.",
          });
      })
      .parse(await readBody(request));
    assertOwnerSetupAccess(request, input.token);
    if (completed)
      throw new AppError(
        "OWNER_ALREADY_EXISTS",
        "Owner setup has already completed. Restart normally and sign in.",
        409,
      );
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      attempts = 0;
    }
    if (++attempts > 5)
      throw new AppError(
        "RATE_LIMITED",
        "Wait one minute before trying Owner setup again.",
        429,
      );
    const admin = supabaseAdmin();
    const db = await supabaseServer();
    await completeOwnerBootstrap(input, {
      async ownerExists() {
        const { data, error } = await admin
          .from("users")
          .select("id")
          .eq("role", "OWNER")
          .limit(1);
        if (error)
          throw new AppError(
            "SCHEMA_REQUIRED",
            "Apply the RIVOX migrations to this project before setting up the Owner.",
            503,
          );
        return Boolean(data?.length);
      },
      ...(localSupabaseAccountCreationAllowed()
        ? {
            async createLocalAccount(email: string, password: string) {
              const { data, error } = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
              });
              if (error || !data.user)
                throw new AppError(
                  "LOCAL_ACCOUNT_CREATION_FAILED",
                  "The local account could not be created. If it already exists, choose the existing-account option.",
                  409,
                );
              return { id: data.user.id };
            },
          }
        : {}),
      async signIn(email, password) {
        const { data, error } = await db.auth.signInWithPassword({
          email,
          password,
        });
        if (error || !data.user?.email)
          throw new AppError(
            "LOGIN_FAILED",
            "The verified account credentials were not accepted.",
            401,
          );
        return {
          id: data.user.id,
          email: data.user.email,
          emailVerified: Boolean(data.user.email_confirmed_at),
        };
      },
      async bootstrap(owner) {
        const { error } = await admin.rpc("bootstrap_owner", {
          owner_id: owner.id,
          owner_email: owner.email,
          owner_name: owner.name,
        });
        if (error)
          throw new AppError(
            "OWNER_SETUP_REJECTED",
            "Owner setup was not applied. Another Owner or staff record may already exist; inspect the workspace instead of resetting data.",
            409,
          );
      },
      async registerSession() {
        const { data, error } = await db.rpc("register_employee_session");
        if (error || !data)
          throw new AppError(
            "SESSION_REGISTRATION_FAILED",
            "The Owner was created, but session registration failed. Restart normally and sign in; do not repeat account creation.",
            503,
          );
      },
      async signOut() {
        await db.auth.signOut({ scope: "local" });
      },
    });
    completed = true;
    return NextResponse.json(
      { ok: true, next: "/mfa" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
