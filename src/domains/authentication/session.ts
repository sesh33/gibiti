import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import {
  permissions,
  type Permission,
  type Role,
} from "@/domains/authorization/permissions";
export async function requireStaff(permission?: Permission) {
  const db = await supabaseServer();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user)
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  const { data: registered, error: sessionError } = await db.rpc(
    "register_employee_session",
  );
  if (sessionError || !registered)
    throw new AppError(
      "SESSION_REVOKED",
      "Your staff session is inactive or revoked.",
      403,
    );
  const { data: profile, error } = await db
    .from("users")
    .select("id,display_name,email,role,active")
    .eq("id", user.id)
    .single();
  if (error || !profile?.active)
    throw new AppError(
      "ACCESS_DENIED",
      "An active staff account is required.",
      403,
    );
  const { data: assurance, error: aalError } =
    await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError)
    throw new AppError("SESSION_INVALID", "Session verification failed.", 401);
  if (
    (profile.role === "OWNER" || profile.role === "ADMIN") &&
    assurance?.currentLevel !== "aal2"
  )
    throw new AppError(
      "MFA_REQUIRED",
      "Complete multi-factor authentication to continue.",
      403,
    );
  const { data: claims, error: claimsError } = await db.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (claimsError || typeof sessionId !== "string")
    throw new AppError(
      "SESSION_INVALID",
      "Session identity could not be verified.",
      401,
    );
  const { data: granted, error: permissionError } =
    await db.rpc("my_permissions");
  if (permissionError)
    throw new AppError(
      "ACCESS_DENIED",
      "Permissions could not be verified.",
      403,
    );
  const allowed = new Set<Permission>(
    ((granted as string[]) ?? []).filter((p): p is Permission =>
      permissions.includes(p as Permission),
    ),
  );
  if (permission && !allowed.has(permission))
    throw new AppError(
      "FORBIDDEN",
      "You do not have permission for this action.",
      403,
    );
  return {
    db,
    user,
    sessionId,
    profile: profile as {
      id: string;
      display_name: string;
      email: string;
      role: Role;
      active: boolean;
    },
    permissions: allowed,
  };
}
