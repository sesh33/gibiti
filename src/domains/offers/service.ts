import "server-only";
import { eldoradoClient } from "@/domains/eldorado/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { documentedOfferReadEndpoints, type OfferSource } from "./definitions";
import { normalizeOffer, parseSellerOfferPage } from "./schemas";

export { documentedOfferReadEndpoints } from "./definitions";
export const offerIntegrationStatus = {
  readAdapterReady: true,
  liveWrites: false,
  reason:
    "Official read adapters are available. Actual readiness is determined by each authenticated synchronization result; writes remain disabled.",
};

export async function readSellerOfferPage(source: OfferSource) {
  const page = await eldoradoClient().read(
    documentedOfferReadEndpoints[source],
    parseSellerOfferPage,
  );
  const syncedAt = new Date().toISOString();
  return {
    items: page.results.map((offer) => normalizeOffer(offer, source, syncedAt)),
    page: {
      index: page.pageIndex,
      size: page.pageSize,
      recordCount: page.recordCount,
      totalPages: page.totalPages,
    },
    hasMore: page.pageIndex < page.totalPages,
  };
}
export async function synchronizeOfferPage(
  actorId: string,
  sessionId: string,
  source: OfferSource,
) {
  const db = supabaseAdmin();
  try {
    const result = await readSellerOfferPage(source);
    const { error } = await db.rpc("persist_offer_page", {
      records: result.items,
      source_name: source,
      page_metadata: result.page,
      actor: actorId,
      actor_session: sessionId,
    });
    if (error)
      throw new AppError(
        "OFFER_SYNC_PERSISTENCE_FAILED",
        "The offer page could not be stored. Its transaction was rolled back.",
        500,
      );
    return {
      source,
      count: result.items.length,
      ...result.page,
      hasMore: result.hasMore,
      upstreamWrites: false,
      paginationReady: false,
    };
  } catch (error) {
    await db
      .from("integration_errors")
      .insert({
        provider: "eldorado-offers:" + source,
        code: error instanceof AppError ? error.code : "CONNECTION_FAILED",
      });
    throw error;
  }
}
