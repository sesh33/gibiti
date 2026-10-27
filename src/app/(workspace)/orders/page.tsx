import { OrderCenter } from "@/components/order-center";
import { authConfigured } from "@/lib/supabase/server";
export default function Page() {
  return <OrderCenter configured={authConfigured()} />;
}
