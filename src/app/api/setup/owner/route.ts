import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSameOrigin, readBody } from "@/lib/http";
import { AppError, errorResponse } from "@/lib/errors";
import {
  assertOwnerSetupAccess,
  completeOwnerBootstrap,
  completeVerifiedOwnerBootstrap,
  hostedOwnerSetupEnabled,
  localSupabaseAccountCreationAllowed,
} from "@/domains/authentication/owner-bootstrap";

let completed = false;
let windowStartedAt = 0;
let attempts = 0;
const identityFields = {
  token: z.string().min(1).max(256),
  email: z.email().max(254),
};
const inputSchema = z.union([
  z
    .object({
      ...identityFields,
      action: z.literal("complete").default("complete"),
      password: z.string().min(8).max(128),
      name: z.string().trim().min(1).max(100),
      confirm: z.literal(true),
      accountMode: z
        .enum(["existing", "create-local", "verified-hosted"])
        .default("existing"),
    })
    .superRefine((input, context) => {
      if (input.accountMode !== "existing" && input.password.length < 14)
        context.addIssue({
          code: "custom",
          path: ["password"],
          message: "Use at least 14 characters for a new account.",
        });
    }),
  z.object({
    ...identityFields,
    action: z.literal("invite"),
    confirm: z.literal(true),
  }),
  z.object({
    ...identityFields,
    action: z.literal("verify"),
    code: z.string().regex(/^\d{6,10}$/),
  }),
  z.object({
    ...identityFields,
    action: z.literal("check-email"),
  }),
]);

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = inputSchema.parse(await readBody(request));
    assertOwnerSetupAccess(request, input.token);
    if (completed)
      throw new AppError(
        "OWNER_ALREADY_EXISTS",
        "Owner setup has already completed. Sign in with your account.",
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
    async function ownerExists() {
      const { data, error } = await admin
        .from("users")
        .select("id")
        .eq("role", "OWNER")
        .limit(1);
      if (error)
        throw new AppError(
          "SCHEMA_REQUIRED",
          "The workspace database is unavailable. Contact the deployment operator.",
          503,
        );
      return Boolean(data?.length);
    }
    async function bootstrap(owner: {
      id: string;
      email: string;
      name: string;
    }) {
      const { error } = await admin.rpc("bootstrap_owner", {
        owner_id: owner.id,
        owner_email: owner.email,
        owner_name: owner.name,
      });
      if (error)
        throw new AppError(
          "OWNER_SETUP_REJECTED",
          "Owner setup was not applied. Another Owner or staff record may already exist; sign in or contact the operator.",
          409,
        );
    }
    async function registerSession() {
      const { data, error } = await db.rpc("register_employee_session");
      if (error || !data)
        throw new AppError(
          "SESSION_REGISTRATION_FAILED",
          "The Owner was created, but session registration failed. Sign in with your account; do not repeat account creation.",
          503,
        );
    }
    async function signOut() {
      await db.auth.signOut({ scope: "local" });
    }
    if (input.action !== "complete") {
      if (!hostedOwnerSetupEnabled())
        throw new AppError(
          "HOSTED_OWNER_SETUP_DISABLED",
          "Verified-email Owner setup is not enabled for this workspace.",
          403,
        );
      if (await ownerExists())
        throw new AppError(
          "OWNER_ALREADY_EXISTS",
          "This workspace already has an Owner. Sign in with your account.",
          409,
        );
      if (input.action === "check-email") {
        const { data, error } = await db.auth.getUser();
        if (
          error ||
          !data.user?.email_confirmed_at ||
          data.user.email?.toLowerCase() !== input.email.toLowerCase()
        )
          throw new AppError(
            "OWNER_EMAIL_VERIFICATION_REQUIRED",
            "Open the verification link from your email in this browser, accept it, then return to this private setup tab.",
            401,
          );
        return NextResponse.json(
          { ok: true, next: "choose-password" },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (input.action === "invite") {
        // Only an explicit form submission with the private capability sends an email.
        // No membership is created until this address is independently verified.
        const { error } = await admin.auth.admin.inviteUserByEmail(
          input.email,
          {
            redirectTo: new URL("/setup/owner", process.env.APP_ORIGIN!).href,
          },
        );
        if (error)
          throw new AppError(
            "OWNER_EMAIL_DELIVERY_UNAVAILABLE",
            "The verification email could not be sent. Supabase's default email service only accepts project-team addresses. Use your project-owner email or an existing verified account; general delivery requires configured SMTP.",
            502,
          );
        return NextResponse.json(
          { ok: true, next: "verify-email" },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const { data, error } = await db.auth.verifyOtp({
        email: input.email,
        token: input.code,
        type: "invite",
      });
      if (
        error ||
        !data.user?.email_confirmed_at ||
        data.user.email?.toLowerCase() !== input.email.toLowerCase()
      ) {
        if (data.user) await signOut();
        throw new AppError(
          "OWNER_EMAIL_CODE_INVALID",
          "The email verification code was not accepted. Check the code and its expiry.",
          401,
        );
      }
      return NextResponse.json(
        { ok: true, next: "choose-password" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (input.accountMode === "verified-hosted") {
      if (!hostedOwnerSetupEnabled())
        throw new AppError(
          "HOSTED_OWNER_SETUP_DISABLED",
          "Verified-email Owner setup is not enabled for this workspace.",
          403,
        );
      await completeVerifiedOwnerBootstrap(input, {
        ownerExists,
        async verifiedIdentity() {
          const { data, error } = await db.auth.getUser();
          if (error || !data.user?.email) return null;
          return {
            id: data.user.id,
            email: data.user.email,
            emailVerified: Boolean(data.user.email_confirmed_at),
          };
        },
        async updatePassword(password) {
          const { error } = await db.auth.updateUser({ password });
          if (error)
            throw new AppError(
              "PASSWORD_SETUP_FAILED",
              "Your password could not be saved. Use a strong password with at least 14 characters.",
              400,
            );
        },
        bootstrap,
        registerSession,
        signOut,
      });
    } else {
      await completeOwnerBootstrap(
        { ...input, accountMode: input.accountMode },
        {
          ownerExists,
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
          bootstrap,
          registerSession,
          signOut,
        },
      );
    }
    completed = true;
    return NextResponse.json(
      { ok: true, next: "/mfa" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
