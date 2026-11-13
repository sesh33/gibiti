import { AutomationSettings } from "@/components/automation-settings";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <AutomationSettings configured={authConfigured()} />;
}
