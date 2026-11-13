import "server-only";
import { eldoradoClient } from "@/domains/eldorado/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { documentedOfferReadEndpoints, type OfferSource } from "./definitions";
import { normalizeOffer, parseSellerOfferPage } from "./schemas";

export { documentedOfferReadEndpoints } from "./definitions";
export const offerIntegrationStatus = {
  readAdapterReady: true,
  availabilityActions: ["pause", "resume"],
  otherWrites: true,
  editingSources: ["predefined"],
  liveWriteValidation: "not-performed",
  reason:
    "Official reads, pause/resume and reviewed predefined creation/details/price/quantity actions are implemented. Reviewed operations require independent approval, explicit execution and MFA. No commercial write was used as a setup test.",
};

export async function readSellerOfferPage(source: OfferSource, pageIndex = 1) {
  const page = await eldoradoClient().read(
    documentedOfferReadEndpoints[source],
    parseSellerOfferPage,
    source === "predefined"
      ? { pageIndex: String(pageIndex), pageSize: "50" }
      : undefined,
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
  pageIndex = 1,
) {
  const db = supabaseAdmin();
  try {
    const result = await readSellerOfferPage(source, pageIndex);
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
      paginationReady: source === "predefined",
    };
  } catch (error) {
    await db.from("integration_errors").insert({
      provider: "eldorado-offers:" + source,
      code: error instanceof AppError ? error.code : "CONNECTION_FAILED",
    });
    throw error;
  }
}
