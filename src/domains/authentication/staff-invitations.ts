import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Permission, Role } from "@/domains/authorization/permissions";
import { AppError } from "@/lib/errors";

export const staffInvitationInput = z
  .object({
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
    name: z.string().trim().min(1).max(100),
    role: z
      .enum([
        "ADMIN",
        "SUPERVISOR",
        "SUPPORT_AGENT",
        "FULFILLMENT_AGENT",
        "VIEWER",
      ])
      .default("SUPPORT_AGENT"),
    // Existing API callers retain email delivery; the UI recommends a private link.
    delivery: z.enum(["email", "link"]).default("email"),
  })
  .strict();
export type StaffInvitationInput = z.infer<typeof staffInvitationInput>;
export type StaffInvitationActor = {
  id: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
};
type InvitationAudit = {
  actorId: string;
  userId: string;
  action:
    | "staff.invitation_prepared"
    | "staff.invited"
    | "staff.invitation_link_created";
  role: StaffInvitationInput["role"];
  delivery: StaffInvitationInput["delivery"];
};
export type StaffInvitationDependencies = {
  origin: string;
  membershipExists(email: string): Promise<boolean>;
  createAccount(email: string): Promise<string>;
  createMembership(user: {
    id: string;
    email: string;
    name: string;
    role: StaffInvitationInput["role"];
  }): Promise<void>;
  activateMembership(id: string): Promise<void>;
  sendEmail(email: string, redirectTo: string): Promise<{ userId: string }>;
  generateLink(
    email: string,
    redirectTo: string,
  ): Promise<{
    userId: string;
    hashedToken: string;
    verificationType: string;
  }>;
  audit(event: InvitationAudit): Promise<void>;
  deactivateMembership(id: string): Promise<void>;
  deleteMembership(id: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  recordFailure(code: string): Promise<void>;
};
export type StaffInvitationResult =
  { delivery: "email" } | { delivery: "link"; inviteUrl: string };

function invitationRedirect(origin: string) {
  try {
    const url = new URL(origin);
    const secure = url.protocol === "https:";
    const loopback =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!secure && !loopback) || url.origin !== origin)
      throw new Error("Invalid invitation origin");
    return new URL("/account/setup", origin).href;
  } catch {
    throw new AppError(
      "SETUP_REQUIRED",
      "Configure the exact HTTPS application origin before inviting staff.",
      503,
    );
  }
}

/** A new Auth account is created atomically first, so compensation never deletes an existing user. */
export async function provisionStaffInvitation(
  actor: StaffInvitationActor,
  input: StaffInvitationInput,
  dependencies: StaffInvitationDependencies,
): Promise<StaffInvitationResult> {
  if (actor.role !== "OWNER" || !actor.permissions.has("team.invite"))
    throw new AppError(
      "FORBIDDEN",
      "Only the Owner can invite employees.",
      403,
    );
  const validated = staffInvitationInput.parse(input);
  const redirectTo = invitationRedirect(dependencies.origin);
  if (await dependencies.membershipExists(validated.email))
    throw new AppError(
      "MEMBERSHIP_EXISTS",
      "This employee already has a membership. Manage the existing account instead of inviting it again.",
      409,
    );
  let ownedAccount: string | undefined;
  try {
    ownedAccount = await dependencies.createAccount(validated.email);
    if (!z.guid().safeParse(ownedAccount).success)
      throw new AppError(
        "INVITATION_ACCOUNT_INVALID",
        "The new invitation account could not be verified.",
        502,
      );
    await dependencies.createMembership({
      id: ownedAccount,
      email: validated.email,
      name: validated.name,
      role: validated.role,
    });
    // The inactive membership cannot gain access before an audit record exists.
    const audit = {
      actorId: actor.id,
      userId: ownedAccount,
      role: validated.role,
      delivery: validated.delivery,
    };
    await dependencies.audit({ ...audit, action: "staff.invitation_prepared" });
    await dependencies.activateMembership(ownedAccount);
    let result: StaffInvitationResult;
    if (validated.delivery === "link") {
      const link = await dependencies.generateLink(validated.email, redirectTo);
      if (
        link.userId !== ownedAccount ||
        link.verificationType !== "invite" ||
        !link.hashedToken ||
        link.hashedToken.length > 8192
      )
        throw new AppError(
          "INVITATION_PROOF_INVALID",
          "The private invitation could not be verified. No link was issued.",
          502,
        );
      const fragment = new URLSearchParams({
        token_hash: link.hashedToken,
        type: "invite",
      });
      result = {
        delivery: "link",
        inviteUrl: redirectTo + "#" + fragment.toString(),
      };
    } else {
      const invitation = await dependencies.sendEmail(
        validated.email,
        redirectTo,
      );
      if (invitation.userId !== ownedAccount)
        throw new AppError(
          "INVITATION_PROOF_INVALID",
          "The email invitation did not match the new employee account.",
          502,
        );
      result = { delivery: "email" };
    }
    await dependencies.audit({
      ...audit,
      action:
        validated.delivery === "link"
          ? "staff.invitation_link_created"
          : "staff.invited",
    });
    return result;
  } catch (error) {
    if (ownedAccount && z.guid().safeParse(ownedAccount).success) {
      // Revoke first, then remove only the account created by this operation.
      try {
        await dependencies.deactivateMembership(ownedAccount);
      } catch {
        /* Continue cleanup. */
      }
      let profileRemoved = false;
      let accountRemoved = false;
      try {
        await dependencies.deleteMembership(ownedAccount);
        profileRemoved = true;
      } catch {
        /* Reconcile below. */
      }
      try {
        await dependencies.deleteAccount(ownedAccount);
        accountRemoved = true;
      } catch {
        /* Reconcile below. */
      }
      if (!profileRemoved || !accountRemoved) {
        try {
          await dependencies.recordFailure("INVITE_ROLLBACK_INCOMPLETE");
        } catch {
          /* No secret or raw error is logged. */
        }
        throw new AppError(
          "INVITATION_RECONCILIATION_REQUIRED",
          "The invitation was not completed. Reconcile this employee account before retrying.",
          500,
        );
      }
    }
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INVITATION_FAILED",
      "The invitation was not completed. No private link was issued.",
      502,
    );
  }
}

export function staffInvitationDependencies(
  admin: SupabaseClient,
  origin: string,
): StaffInvitationDependencies {
  return {
    origin,
    async membershipExists(email) {
      const pattern = email.replace(/[\\%_]/g, "\\$&");
      const { data, error } = await admin
        .from("users")
        .select("id")
        .ilike("email", pattern)
        .limit(1);
      if (error)
        throw new AppError(
          "QUERY_FAILED",
          "Existing staff membership could not be verified.",
          503,
        );
      return Boolean(data?.length);
    },
    async createAccount(email) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
      });
      if (error || !data.user) {
        if (
          error &&
          ["email_exists", "user_already_exists"].includes(error.code || "")
        )
          throw new AppError(
            "ACCOUNT_EXISTS",
            "This address already has an account. Reconcile its existing membership before inviting it again.",
            409,
          );
        throw new AppError(
          "INVITATION_ACCOUNT_FAILED",
          "The new employee account could not be confirmed. Check account status before retrying.",
          502,
        );
      }
      return data.user.id;
    },
    async createMembership(user) {
      const { error } = await admin
        .from("users")
        .insert({
          id: user.id,
          email: user.email,
          display_name: user.name,
          role: user.role,
          active: false,
        });
      if (error)
        throw new AppError(
          "INVITATION_MEMBERSHIP_FAILED",
          "The employee membership could not be prepared.",
          500,
        );
    },
    async activateMembership(id) {
      const { error } = await admin
        .from("users")
        .update({ active: true })
        .eq("id", id);
      if (error)
        throw new AppError(
          "INVITATION_MEMBERSHIP_FAILED",
          "The employee membership could not be activated.",
          500,
        );
    },
    async generateLink(email, redirectTo) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo },
      });
      if (error || !data.user || !data.properties)
        throw new AppError(
          "INVITATION_LINK_FAILED",
          "The private invitation could not be created. No email was sent.",
          502,
        );
      return {
        userId: data.user.id,
        hashedToken: data.properties.hashed_token,
        verificationType: data.properties.verification_type,
      };
    },
    async sendEmail(email, redirectTo) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
      });
      if (error || !data.user)
        throw new AppError(
          "INVITATION_EMAIL_FAILED",
          "Email delivery failed. Choose a private invitation link or configure an email provider.",
          502,
        );
      return { userId: data.user.id };
    },
    async audit(event) {
      const { error } = await admin
        .from("audit_logs")
        .insert({
          actor_id: event.actorId,
          action: event.action,
          target_type: "user",
          target_id: event.userId,
          metadata: { role: event.role, delivery: event.delivery },
        });
      if (error)
        throw new AppError(
          "AUDIT_FAILED",
          "The invitation could not be audited and was not completed.",
          500,
        );
    },
    async deactivateMembership(id) {
      const { error } = await admin
        .from("users")
        .update({ active: false })
        .eq("id", id);
      if (error) throw new Error("Membership deactivation failed");
    },
    async deleteMembership(id) {
      const { error } = await admin.from("users").delete().eq("id", id);
      if (error) throw new Error("Membership cleanup failed");
    },
    async deleteAccount(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error("Account cleanup failed");
    },
    async recordFailure(code) {
      const { error } = await admin
        .from("integration_errors")
        .insert({ provider: "supabase-auth", code });
      if (error) throw new Error("Failure recording unavailable");
    },
  };
}
