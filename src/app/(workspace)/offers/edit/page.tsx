import { OfferEditor } from "@/components/offer-editor";
import { authConfigured } from "@/lib/supabase/server";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const query = await searchParams;
  const key = typeof query.id === "string" ? query.id : "new";
  return <OfferEditor key={key} configured={authConfigured()} />;
}
