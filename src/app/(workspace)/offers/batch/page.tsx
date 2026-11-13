import { OfferBatchCenter } from "@/components/offer-batch-center";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <OfferBatchCenter configured={authConfigured()} />;
}
