import { AuthForm } from "@/components/auth-forms";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <AuthForm mode="login" configured={authConfigured()} />;
}
