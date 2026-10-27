import { Overview } from "@/components/overview";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <Overview configured={authConfigured()} />;
}
