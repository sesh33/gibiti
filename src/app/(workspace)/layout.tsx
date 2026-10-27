import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { authConfigured } from "@/lib/supabase/server";
import { requireStaff } from "@/domains/authentication/session";
import { AppError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = authConfigured();
  let staff = null;
  if (configured) {
    try {
      const current = await requireStaff();
      staff = {
        name: current.profile.display_name,
        role: current.profile.role,
        permissions: [...current.permissions],
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "MFA_REQUIRED")
        redirect("/mfa");
      redirect("/login");
    }
  }
  return (
    <WorkspaceShell configured={configured} staff={staff}>
      {children}
    </WorkspaceShell>
  );
}
