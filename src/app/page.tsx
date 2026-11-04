import { redirect } from "next/navigation";
import { requireStaff } from "@/domains/authentication/session";
import { workspaceHome } from "@/domains/authorization/workspace-home";
import { authConfigured } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export default async function Page() {
  if (!authConfigured()) redirect("/orders");
  let destination: string;
  try {
    const staff = await requireStaff();
    destination = workspaceHome(staff.permissions);
  } catch (error) {
    destination =
      error instanceof AppError && error.code === "MFA_REQUIRED"
        ? "/mfa"
        : "/login";
  }
  redirect(destination);
}
