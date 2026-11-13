import { ReportsCenter } from "@/components/reports-center";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <ReportsCenter configured={authConfigured()} />;
}
