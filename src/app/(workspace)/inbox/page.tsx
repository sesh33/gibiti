import { SmartInbox } from "@/components/smart-inbox";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <SmartInbox configured={authConfigured()} />;
}
