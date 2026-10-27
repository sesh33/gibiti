import { OffersModule } from "@/components/operations-modules";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <OffersModule configured={authConfigured()} />;
}
