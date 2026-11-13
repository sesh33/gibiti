import { OrderDetail } from "@/components/order-detail";
import { authConfigured } from "@/lib/supabase/server";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderDetail key={id} id={id} configured={authConfigured()} />;
}
