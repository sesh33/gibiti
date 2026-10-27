import { TeamModule } from "@/components/operations-modules";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <TeamModule configured={authConfigured()} />;
}
