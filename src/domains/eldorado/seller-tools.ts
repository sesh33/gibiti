import "server-only";
import { z } from "zod";
import { eldoradoClient } from "./client";
import { sellerAction } from "./seller-contracts";
import { AppError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { requireStaff } from "@/domains/authentication/session";
type Staff = Awaited<ReturnType<typeof requireStaff>>;
const text = (row: Record<string, unknown>, key: string) =>
  typeof row[key] === "string" ? row[key].slice(0, 4000) : null;
export function normalizeNotification(raw: unknown) {
  const row = z.record(z.string(), z.unknown()).parse(raw);
  const id =
    typeof row.id === "string" && /^[A-Za-z0-9_-]{1,150}$/.test(row.id)
      ? row.id
      : null;
  return {
    id,
    title: text(row, "title"),
    message: text(row, "message"),
    type: text(row, "type"),
    createdAt: text(row, "createdDate"),
    isRead: typeof row.isRead === "boolean" ? row.isRead : null,
  };
}
export async function readNotifications(
  cursor?: string,
  client = eldoradoClient(),
) {
  const page = await client.read(
    "/api/notifications/me",
    (raw) =>
      z
        .object({
          results: z.array(z.unknown()),
          nextPageCursor: z.string().nullable().optional(),
        })
        .parse(raw),
    {
      pageSize: "25",
      ...(cursor ? { cursorValue: cursor, pageDirection: "Next" } : {}),
    },
  );
  return {
    items: page.results.map(normalizeNotification),
    nextCursor: page.nextPageCursor ?? null,
    checkedAt: new Date().toISOString(),
  };
}
export async function readSellerOverview(client = eldoradoClient()) {
  const checks = await Promise.allSettled([
    client.read(
      "/api/v1/orders/me/seller-api-eligibility",
      (raw) => z.object({ isEligible: z.boolean() }).parse(raw).isEligible,
    ),
    client.read("/api/offerUser/me/restrictions", (raw) =>
      z
        .array(z.unknown())
        .parse(raw)
        .map((value) => {
          if (typeof value === "string")
            return { reason: value.slice(0, 4000) };
          const row = z.record(z.string(), z.unknown()).parse(value);
          return {
            reason: text(row, "reason") ?? text(row, "message"),
            type: text(row, "type"),
            until: text(row, "endDate"),
          };
        }),
    ),
    client.read("/api/notifications/me/unread-count", (raw) =>
      z
        .object({
          unread: z.number().int().nonnegative(),
          hasMore: z.boolean(),
        })
        .parse(raw),
    ),
    client.read("/api/v1/orders/me/pending-review-order-count", (raw) =>
      z.number().int().nonnegative().parse(raw),
    ),
  ]);
  const names = ["eligibility", "restrictions", "unread", "pendingReviews"];
  return {
    checkedAt: new Date().toISOString(),
    checks: checks.map((item, index) =>
      item.status === "fulfilled"
        ? { name: names[index], ok: true, value: item.value }
        : {
            name: names[index],
            ok: false,
            code:
              item.reason instanceof AppError
                ? item.reason.code
                : "UPSTREAM_CONTRACT",
          },
    ),
  };
}
export const sellerActionInput = z
  .object({
    action: sellerAction,
    reason: z.string().trim().min(10).max(2000),
    idempotencyKey: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();
export async function executeSellerAction(raw: unknown, staff: Staff) {
  const input = sellerActionInput.parse(raw),
    statusChange = input.action.kind.startsWith("seller.");
  if (
    statusChange
      ? staff.profile.role !== "OWNER" ||
        !staff.permissions.has("seller.manage")
      : !staff.permissions.has("notifications.manage") ||
        !staff.permissions.has("notifications.read")
  )
    throw new AppError(
      "FORBIDDEN",
      "This Seller action is not allowed for your account.",
      403,
    );
  const { data, error } = await staff.db.rpc("begin_seller_action", {
    action_kind: input.action.kind,
    notification:
      "notificationId" in input.action ? input.action.notificationId : null,
    justification: input.reason,
    request_key: input.idempotencyKey,
  });
  if (error || !data)
    throw new AppError(
      "SELLER_ACTION_CONFLICT",
      "Check MFA and resolve any pending action before submitting. The action was not sent.",
      409,
    );
  const claim = data as {
    claimed: boolean;
    operation: { id: string; status: string };
  };
  if (!claim.claimed)
    return {
      operation: claim.operation,
      reused: true,
      message: "Existing action recovered. No request was sent again.",
    };
  const admin = supabaseAdmin();
  let outcome = "acknowledged",
    code: string | null = null;
  try {
    await eldoradoClient().writeSellerAction(input.action, async () => {
      const { error: denied } = await admin.rpc("authorize_seller_action", {
        operation_id: claim.operation.id,
      });
      if (denied)
        throw new AppError(
          "ELDORADO_WRITE_NOT_SENT",
          "Your Seller action authority is no longer active. No change was sent.",
          403,
        );
    });
  } catch (error) {
    code = error instanceof AppError ? error.code : "ELDORADO_WRITE_UNKNOWN";
    outcome = ["ELDORADO_WRITE_NOT_SENT", "ELDORADO_WRITE_REJECTED"].includes(
      code,
    )
      ? "rejected"
      : "unknown";
  }
  const { data: operation, error: finishError } = await admin.rpc(
    "finish_seller_action",
    { operation_id: claim.operation.id, outcome, failure_code: code },
  );
  if (finishError)
    throw new AppError(
      "SELLER_RESULT_PENDING",
      "The action result could not be saved. Recover it using the same request key; do not send another action.",
      503,
    );
  return {
    operation,
    reused: false,
    message:
      outcome === "acknowledged"
        ? "Eldorado accepted the request. Availability has no independent status-read contract here; verify it on Eldorado. Notification counts can be refreshed."
        : outcome === "unknown"
          ? "The outcome is uncertain. No automatic retry was sent. Verify the action directly on Eldorado before recording a manual check."
          : "The request was not accepted. No automatic retry was sent.",
  };
}
