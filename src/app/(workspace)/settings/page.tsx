import { Settings } from "@/components/settings";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <Settings configured={authConfigured()} />;
}
