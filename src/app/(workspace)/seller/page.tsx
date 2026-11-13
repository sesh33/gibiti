import { SellerCenter } from "@/components/seller-center";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <SellerCenter configured={authConfigured()} />;
}
