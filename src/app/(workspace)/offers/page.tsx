import { OffersCenter } from "@/components/offers-center";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <OffersCenter configured={authConfigured()} />;
}
