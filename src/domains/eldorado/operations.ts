import "server-only";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { EldoradoClient, eldoradoClient } from "./client";
import {
  requiredChangePermissions,
  marketplaceChange,
  operationInput,
  type MarketplaceChange,
} from "./contracts";
import { requireStaff } from "@/domains/authentication/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { synchronizeOfferPage } from "@/domains/offers/service";
import { pricingValidation } from "./pricing-validation";
type Staff = Awaited<ReturnType<typeof requireStaff>>;
export type MarketTicket = {
  id: string;
  requester_id: string;
  approver_id: string | null;
  action: string;
  target_id: string;
  status: string;
  external_attempted: boolean;
  repricing_quote_id?: string | null;
  automatic_delivery_requested?: boolean;
  payload: {
    marketV1: true;
    automaticPolicyId?: string;
    automaticPolicyVersion?: string;
    change: MarketplaceChange;
    nativeId: string | null;
    before: Record<string, unknown>;
  };
  result?: Record<string, unknown> | null;
};

async function current(
  change: MarketplaceChange,
  id: string,
  client: EldoradoClient,
): Promise<Record<string, unknown>> {
  if (change.kind.startsWith("offer.")) return client.predefinedSnapshot(id);
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const result = await client.orders(cursor);
    const order = result.results.find(
      (item) => item.id.toLowerCase() === id.toLowerCase(),
    );
    if (order)
      return {
        id: order.id,
        state: order.state.state,
        deliveryTime: order.deliveryTime ?? null,
      };
    if (!result.nextPageCursor || seen.has(result.nextPageCursor)) break;
    cursor = result.nextPageCursor;
    seen.add(cursor);
  }
  throw new AppError(
    "ORDER_NOT_VERIFIED",
    "The order was not found in the checked Seller API pages. Synchronize and review it before proceeding.",
    409,
  );
}
function eligible(
  change: MarketplaceChange,
  snapshot: Record<string, unknown>,
) {
  if (change.kind === "order.correct") return snapshot.state === "Delivered";
  return change.kind.startsWith("offer.")
    ? ["Active", "Paused"].includes(String(snapshot.state))
    : ["Paid"].includes(String(snapshot.state));
}
export async function requestMarketOperation(raw: unknown, staff: Staff) {
  const input = operationInput.parse(raw);
  if (
    input.automaticDelivery &&
    (input.change.kind !== "order.deliver" || !input.fulfillmentConfirmed)
  )
    throw new AppError(
      "FULFILLMENT_CONFIRMATION_REQUIRED",
      "Automatic marking requires an explicit confirmation that the actual transfer is complete.",
      400,
    );
  if (
    !requiredChangePermissions(input.change.kind).every((permission) =>
      staff.permissions.has(permission),
    )
  )
    throw new AppError(
      "FORBIDDEN",
      "Your permissions do not allow this operation.",
      403,
    );
  const { data: prior, error: priorError } = await staff.db
    .from("approval_requests")
    .select("id,payload,target_id,reason,automatic_delivery_requested")
    .eq("idempotency_key", input.idempotencyKey)
    .eq("requester_id", staff.user.id)
    .maybeSingle();
  if (priorError)
    throw new AppError(
      "REQUEST_LOOKUP_FAILED",
      "The operation history could not be checked.",
      503,
    );
  if (prior) {
    if (
      prior.target_id !== input.target ||
      prior.reason !== input.reason ||
      Boolean(prior.automatic_delivery_requested) !==
        Boolean(input.automaticDelivery) ||
      !isDeepStrictEqual(prior.payload?.change, input.change) ||
      (prior.payload?.expectedSnapshot
        ? Date.parse(prior.payload.expectedSnapshot)
        : null) !==
        (input.expectedSnapshot ? Date.parse(input.expectedSnapshot) : null)
    )
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "This request key belongs to a different operation.",
        409,
      );
    return { id: prior.id, reused: true };
  }
  let before: Record<string, unknown> = {};
  if (input.change.kind !== "offer.create") {
    const id = input.change.kind.startsWith("offer.")
      ? input.target.replace(/^predefined:/, "")
      : input.target;
    z.guid().parse(id);
    const table = input.change.kind.startsWith("offer.") ? "offers" : "orders";
    const { data: record, error } = await staff.db
      .from(table)
      .select("id")
      .eq("id", input.target)
      .maybeSingle();
    if (error || !record)
      throw new AppError(
        "NOT_FOUND",
        "The target is not accessible to this staff account.",
        404,
      );
    if (table === "offers" && !input.target.startsWith("predefined:"))
      throw new AppError(
        "UNSUPPORTED_SOURCE",
        "These editing contracts apply to predefined offers only.",
        400,
      );
    before = await current(input.change, id, eldoradoClient());
    if (!eligible(input.change, before))
      throw new AppError(
        "INELIGIBLE_STATE",
        "This state is not eligible. Synchronize the current listing or order.",
        409,
      );
    if (
      input.change.kind === "offer.price" &&
      input.change.body.currency !== before.currency
    )
      throw new AppError(
        "CURRENCY_CHANGE_BLOCKED",
        "Use the listing's existing currency for an individual price change.",
        400,
      );
  }
  const rpcName =
    input.change.kind === "order.correct"
      ? "request_delivery_correction"
      : input.automaticDelivery
        ? "request_marketplace_with_delivery_optin"
        : "request_marketplace_operation";
  const { data, error } = await staff.db.rpc(rpcName, {
    change: input.change,
    target: input.target,
    expected_snapshot: input.expectedSnapshot,
    remote_before: before,
    justification: input.reason,
    request_key: input.idempotencyKey,
    ...(input.automaticDelivery ? { transfer_confirmed: true } : {}),
  });
  if (error && input.automaticDelivery && error.code === "42501")
    throw new AppError(
      "AUTO_DELIVERY_AUTH_REQUIRED",
      "Automatic delivery marking requires MFA, workspace authorization and a confirmed completed transfer.",
      403,
    );
  if (error)
    throw new AppError(
      "OPERATION_CONFLICT",
      "This target changed, has an unresolved operation, or is no longer permitted. Synchronize and review before requesting again.",
      409,
    );
  return { id: z.uuid().parse(data), reused: false };
}
export async function loadMarketTicket(
  id: string,
  staff: Staff,
): Promise<MarketTicket> {
  const { data, error } = await staff.db
    .from("approval_requests")
    .select("*")
    .eq("id", z.uuid().parse(id))
    .single();
  if (error || !data || data.payload?.marketV1 !== true)
    throw new AppError("NOT_FOUND", "The operation is not accessible.", 404);
  marketplaceChange.parse(data.payload.change);
  return data as MarketTicket;
}
export function matchesChange(
  change: MarketplaceChange,
  before: Record<string, unknown>,
  observed: Record<string, unknown>,
  acknowledged = false,
) {
  switch (change.kind) {
    case "offer.price":
      return (
        observed.price === change.body.amount &&
        observed.currency === change.body.currency
      );
    case "offer.quantity":
      return observed.quantity === change.body;
    case "offer.details":
      return (
        acknowledged &&
        isDeepStrictEqual(observed.details, change.body.details) &&
        observed.gameId === change.body.augmentedGame.gameId &&
        observed.category === change.body.augmentedGame.category
      );
    case "offer.create":
      return acknowledged;
    case "order.deliver":
      return ["Delivered", "Received", "Completed"].includes(
        String(observed.state),
      );
    case "order.cancel":
      return ["Canceled", "Cancelled"].includes(String(observed.state));
    case "order.extend":
    case "order.correct":
      return acknowledged;
  }
}
export type OperationDependencies = {
  validateQuote?(): Promise<void>;
  refreshCreated?(): Promise<unknown>;
  current(
    change: MarketplaceChange,
    id: string,
  ): Promise<Record<string, unknown>>;
  claim(): Promise<MarketTicket>;
  write(
    change: MarketplaceChange,
    id?: string,
  ): ReturnType<EldoradoClient["writeMarketplace"]>;
  finish(
    status: string,
    proof: Record<string, unknown> | null,
    code: string | null,
  ): Promise<MarketTicket>;
};
export async function executeMarketTicket(
  ticket: MarketTicket,
  dependencies: OperationDependencies,
  reconcileOnly = false,
) {
  const change = marketplaceChange.parse(ticket.payload.change);
  if (["succeeded", "failed", "rejected"].includes(ticket.status))
    return {
      operation: ticket,
      message:
        "This operation already has a recorded result. No change was sent again.",
    };
  if (reconcileOnly || ["executing", "blocked"].includes(ticket.status)) {
    if (!["executing", "blocked"].includes(ticket.status))
      return {
        operation: ticket,
        message: "The operation has not been executed. No change was sent.",
      };
    if (
      change.kind === "offer.create" &&
      ticket.result?.acknowledged === true &&
      dependencies.refreshCreated
    ) {
      await dependencies.refreshCreated();
      return {
        operation: await dependencies.finish(
          "succeeded",
          {
            ...ticket.result,
            verified: true,
            acknowledged: true,
            document: change.body,
            verification: "HTTP-201-accepted; catalog-refreshed",
          },
          null,
        ),
        message:
          "The accepted creation was reconciled with a fresh catalog read. No creation was sent again.",
      };
    }
    const target = ticket.payload.nativeId;
    if (target) {
      const observed = await dependencies.current(change, target);
      if (
        matchesChange(
          change,
          ticket.payload.before,
          observed,
          ticket.result?.acknowledged === true,
        )
      )
        return {
          operation: await dependencies.finish(
            "succeeded",
            {
              ...observed,
              verified: true,
              ...(change.kind === "offer.details"
                ? { document: change.body }
                : {}),
              verification:
                ticket.result?.acknowledged === true
                  ? "accepted-response-and-current-read"
                  : "observed-after-uncertain-response",
            },
            null,
          ),
          message:
            "The recorded result was reconciled with current data. No change was sent again.",
        };
    }
    return {
      operation: ticket,
      message:
        "The outcome is still uncertain. The target stays locked; no retry was sent.",
    };
  }
  if (ticket.status !== "approved")
    throw new AppError(
      "APPROVAL_REQUIRED",
      "A different authorized reviewer must approve this exact request first.",
      409,
    );
  if (dependencies.validateQuote) {
    try {
      await dependencies.validateQuote();
    } catch (error) {
      if (
        error instanceof AppError &&
        ["ELDORADO_RATE_LIMITED", "ELDORADO_UNREACHABLE"].includes(error.code)
      )
        throw error;
      return {
        operation: await dependencies.finish(
          "failed",
          null,
          error instanceof AppError ? error.code : "QUOTE_CHECK_FAILED",
        ),
        message:
          error instanceof AppError
            ? error.message
            : "The market could not be confirmed. No change was sent.",
      };
    }
  }
  if (change.kind !== "offer.create") {
    const fresh = await dependencies.current(change, ticket.payload.nativeId!);
    if (
      !eligible(change, fresh) ||
      !isDeepStrictEqual(fresh, ticket.payload.before)
    )
      return {
        operation: await dependencies.finish(
          "failed",
          null,
          "SNAPSHOT_CHANGED",
        ),
        message:
          "The target changed after the request. Synchronize and submit a new request for review.",
      };
  }
  const claimed = await dependencies.claim();
  let acknowledgement: Awaited<ReturnType<EldoradoClient["writeMarketplace"]>>;
  try {
    acknowledgement = await dependencies.write(
      change,
      claimed.payload.nativeId ?? undefined,
    );
  } catch (error) {
    const code =
      error instanceof AppError ? error.code : "ELDORADO_WRITE_UNKNOWN";
    const definitive = [
      "ELDORADO_WRITE_REJECTED",
      "ELDORADO_WRITE_NOT_SENT",
    ].includes(code);
    return {
      operation: await dependencies.finish(
        definitive ? "rejected" : "blocked",
        null,
        code,
      ),
      message: definitive
        ? error instanceof AppError
          ? error.message
          : "Eldorado did not accept this operation. Its result was recorded."
        : "The result is uncertain. Check status; no automatic retry was sent.",
    };
  }
  if (change.kind === "offer.create") {
    try {
      await dependencies.refreshCreated?.();
    } catch {
      return {
        operation: await dependencies.finish(
          "blocked",
          {
            acknowledged: true,
            ...(acknowledgement.createdId
              ? { createdId: acknowledgement.createdId }
              : {}),
          },
          "POSTFLIGHT_READ_FAILED",
        ),
        message:
          "Eldorado accepted creation, but the catalog could not be refreshed. Check this operation; do not create it again.",
      };
    }
    return {
      operation: await dependencies.finish(
        "succeeded",
        {
          verified: true,
          acknowledged: true,
          verification: "HTTP-201-accepted; catalog-refreshed",
          document: change.body,
          ...(acknowledgement.createdId
            ? { createdId: acknowledgement.createdId }
            : {}),
        },
        null,
      ),
      message:
        "Eldorado accepted the new offer and the predefined catalog was refreshed. Inspect the resulting listing before further changes.",
    };
  }
  let observed: Record<string, unknown>;
  try {
    observed = await dependencies.current(change, claimed.payload.nativeId!);
  } catch {
    return {
      operation: await dependencies.finish(
        "blocked",
        { acknowledged: true },
        "POSTFLIGHT_READ_FAILED",
      ),
      message:
        "Eldorado accepted the request but its current data could not be read. Check status before another change.",
    };
  }
  if (!matchesChange(change, ticket.payload.before, observed, true))
    return {
      operation: await dependencies.finish(
        "blocked",
        { ...observed, acknowledged: true },
        "RESULT_NOT_CONFIRMED",
      ),
      message:
        "The requested values were not observed yet. Check status; no retry was sent.",
    };
  return {
    operation: await dependencies.finish(
      "succeeded",
      {
        ...observed,
        verified: true,
        acknowledged: true,
        ...(change.kind === "offer.details"
          ? {
              document: change.body,
              verification:
                "details-and-product-observed; game-attributes-acknowledged",
            }
          : change.kind === "order.correct"
            ? {
                verification:
                  "HTTP-200-accepted; correction-text-not-independently-readable",
              }
            : change.kind === "order.extend"
              ? {
                  verification:
                    "HTTP-204-accepted; deadline-not-independently-verified",
                }
              : { verification: "observed" }),
      },
      null,
    ),
    message:
      change.kind === "order.extend"
        ? "Eldorado accepted the extension. The displayed deadline is the value read from Eldorado."
        : "The marketplace result was recorded and its current values refreshed.",
  };
}
export function operationDependencies(
  ticket: MarketTicket,
  staff: Staff,
): OperationDependencies {
  const client = eldoradoClient(),
    admin = supabaseAdmin(),
    pricing = pricingValidation(ticket.id, ticket.repricing_quote_id, admin);
  return {
    ...(ticket.repricing_quote_id
      ? {
          validateQuote: pricing.verify,
        }
      : {}),
    refreshCreated: () =>
      synchronizeOfferPage(staff.user.id, staff.sessionId, "predefined"),
    current: (change, id) => current(change, id, client),
    write: (change, id) =>
      client.writeMarketplace(change, id, async () => {
        const { error } = await staff.db.rpc(
          "assert_claimed_marketplace_authority",
          {
            operation_id: ticket.id,
          },
        );
        if (error)
          throw new AppError(
            "ELDORADO_WRITE_NOT_SENT",
            "Current MFA, permissions and independent approval could not be verified. No marketplace change was sent.",
            409,
          );
        pricing.beforeSend();
      }),
    async claim() {
      const { data, error } = await staff.db.rpc(
        "claim_marketplace_operation",
        { operation_id: ticket.id },
      );
      if (error)
        throw new AppError(
          "CLAIM_REJECTED",
          "Execution requires MFA, a valid independent approval, current permissions and an unclaimed request.",
          409,
        );
      return data as MarketTicket;
    },
    async finish(outcome, proof, code) {
      const { data, error } = await admin.rpc("finish_marketplace_operation", {
        operation_id: ticket.id,
        outcome,
        proof,
        failure_code: code,
      });
      if (error)
        throw new AppError(
          "RESULT_RECORD_PENDING",
          "The result could not be recorded. Do not repeat the change; check this operation's status.",
          503,
        );
      return data as MarketTicket;
    },
  };
}
export { current as readMarketCurrent };
