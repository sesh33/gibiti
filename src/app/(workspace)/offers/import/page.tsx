import { OfferImportCenter } from "@/components/offer-import-center";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <OfferImportCenter configured={authConfigured()} />;
}
