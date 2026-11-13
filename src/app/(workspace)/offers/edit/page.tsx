import { OfferEditor } from "@/components/offer-editor";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <OfferEditor configured={authConfigured()} />;
}
