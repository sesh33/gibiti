import { OrderDetail } from "@/components/order-detail";
import { authConfigured } from "@/lib/supabase/server";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <OrderDetail id={(await params).id} configured={authConfigured()} />;
}
