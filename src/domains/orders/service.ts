import "server-only";
import type { UpstreamOrder } from "@/domains/eldorado/client";
import { eldoradoClient } from "@/domains/eldorado/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
export function normalizeOrder(order: UpstreamOrder) {
  return {
    id: order.id,
    buyer_id: order.buyerId ?? null,
    buyer_username: order.buyerUsername,
    offer_id: order.offerId ?? null,
    quantity: order.purchaseQuantity,
    amount: order.totalPrice.amount,
    currency: order.totalPrice.currency,
    state: order.state.state,
    product_title: order.orderOfferDetails.offerTitle,
    game_id: order.orderOfferDetails.gameId ?? null,
    delivery_method: order.orderOfferDetails.deliveryMethod ?? null,
    delivery_time: order.deliveryTime ?? null,
    conversation_ref: order.talkJsConversationId ?? null,
    purchased_at: order.createdDate,
    synced_at: new Date().toISOString(),
    details: {
      description: order.orderOfferDetails.description,
      category: order.orderOfferDetails.category,
      dispute: order.latestDispute,
      cancelation: order.cancelation,
    },
  };
}
export async function synchronizeOrders(
  actorId: string,
  sessionId: string,
  cursor?: string,
) {
  const db = supabaseAdmin();
  try {
    const page = await eldoradoClient().orders(cursor);
    const { error } = await db.rpc("persist_order_page", {
      records: page.results.map(normalizeOrder),
      history: page.results.flatMap((order) =>
        order.stateLogs.map((log) => ({
          order_id: order.id,
          state: log.state,
          occurred_at: log.createdDate,
        })),
      ),
      next_cursor: page.nextPageCursor ?? null,
      actor: actorId,
      actor_session: sessionId,
    });
    if (error)
      throw new AppError(
        "SYNC_PERSISTENCE_FAILED",
        "The page could not be saved. The transaction was rolled back.",
        500,
      );
    return {
      count: page.results.length,
      nextCursor: page.nextPageCursor ?? null,
      scope: "partial" as const,
    };
  } catch (error) {
    await db.from("integration_errors").insert({
      provider: "eldorado",
      code: error instanceof AppError ? error.code : "CONNECTION_FAILED",
    });
    throw error;
  }
}
