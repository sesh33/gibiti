import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { eldoradoClient, type OrderPage } from "@/domains/eldorado/client";
import { sellerConnectionStatus } from "@/domains/eldorado/credentials";
import { normalizeOrder } from "@/domains/orders/service";
import {
  executeMarketTicket,
  readMarketCurrent,
  type MarketTicket,
  type OperationDependencies,
} from "@/domains/eldorado/operations";
import {
  buildPricingQuote,
  persistQuote,
  validateQuoteBeforeWrite,
} from "@/domains/pricing/quotes";
import type { PricingPolicy } from "@/domains/pricing/models";
import { AppError } from "@/lib/errors";

export function validWorkerAuthorization(
  header: string | null,
  expected = process.env.CRON_SECRET,
) {
  if (!expected || expected.length < 40 || !header?.startsWith("Bearer "))
    return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}
type Plan = {
  lease: string;
  actorId: string;
  sessionId: string;
  pollDue: boolean;
  watermark: string | null;
  operationId: string | null;
  policy: PricingPolicy | null;
};
type Cursor = { cursor: string; stop_at: string | null };
export function pollProgress(page: OrderPage, watermark: string | null) {
  const dates = page.results.map((order) => Date.parse(order.createdDate));
  const newest = dates.length
    ? new Date(Math.max(...dates)).toISOString()
    : watermark;
  const gap =
    !!page.nextPageCursor &&
    (!watermark ||
      (dates.length > 0 &&
        dates.every((date) => date > Date.parse(watermark))));
  return {
    newest,
    gapCursor: gap ? page.nextPageCursor! : null,
    gapStop: watermark,
  };
}
export async function workerDiagnostic() {
  const admin = supabaseAdmin();
  const [runtime, settings, connection] = await Promise.all([
    admin
      .from("automation_runtime")
      .select(
        "scheduler_configured,last_heartbeat_at,last_error_code,backoff_until",
      )
      .eq("id", true)
      .single(),
    admin
      .from("workspace_preferences")
      .select("poll_enabled,auto_delivery_enabled,auto_pricing_enabled")
      .eq("id", true)
      .single(),
    sellerConnectionStatus(),
  ]);
  if (runtime.error || settings.error)
    throw new AppError(
      "WORKER_STORE_UNAVAILABLE",
      "The background runner database could not be checked.",
      503,
    );
  return {
    mode: "diagnostic",
    origin: process.env.APP_ORIGIN ?? null,
    database: true,
    scheduler: runtime.data,
    settings: settings.data,
    eldoradoConfigured: connection.configured,
    upstreamWrites: 0,
  };
}
async function pollOrders(plan: Plan) {
  const admin = supabaseAdmin(),
    client = eldoradoClient();
  const persist = async (page: OrderPage) => {
    const { error } = await admin.rpc("persist_order_page", {
      records: page.results.map(normalizeOrder),
      history: page.results.flatMap((order) =>
        order.stateLogs.map((log) => ({
          order_id: order.id,
          state: log.state,
          occurred_at: log.createdDate,
        })),
      ),
      next_cursor: page.nextPageCursor ?? null,
      actor: plan.actorId,
      actor_session: plan.sessionId,
    });
    if (error)
      throw new AppError(
        "AUTO_SYNC_PERSISTENCE_FAILED",
        "The background order page could not be persisted.",
        503,
      );
  };
  const { data: pending, error: cursorError } = await admin
    .from("automation_sync_cursors")
    .select("cursor,stop_at")
    .order("created_at")
    .limit(1);
  if (cursorError)
    throw new AppError(
      "CURSOR_STORE_UNAVAILABLE",
      "The persistent polling cursor could not be loaded.",
      503,
    );
  const first = await client.orders();
  await persist(first);
  const progress = pollProgress(first, plan.watermark);
  const job = (pending?.[0] ?? null) as Cursor | null;
  let continued: string | null = null;
  if (job) {
    const page = await client.orders(job.cursor);
    await persist(page);
    const reached =
      job.stop_at != null &&
      page.results.some(
        (order) => Date.parse(order.createdDate) <= Date.parse(job.stop_at!),
      );
    continued =
      !reached && page.nextPageCursor !== job.cursor
        ? (page.nextPageCursor ?? null)
        : null;
  }
  const { error } = await admin.rpc("complete_automation_poll", {
    lease: plan.lease,
    new_watermark: progress.newest,
    gap_cursor: progress.gapCursor,
    gap_stop: progress.gapStop,
    processed_cursor: job?.cursor ?? null,
    continued_cursor: continued,
    continued_stop: job?.stop_at ?? null,
  });
  if (error)
    throw new AppError(
      "CURSOR_SAVE_FAILED",
      "The polling progress could not be saved.",
      503,
    );
  return { firstPage: first.results.length, backfillPage: !!job };
}
function automatedDependencies(
  ticket: MarketTicket,
  plan: Plan,
): OperationDependencies {
  const admin = supabaseAdmin(),
    client = eldoradoClient();
  return {
    current: (change, id) => readMarketCurrent(change, id, client),
    ...(ticket.repricing_quote_id
      ? {
          validateQuote: () =>
            validateQuoteBeforeWrite(ticket.repricing_quote_id!),
        }
      : {}),
    async claim() {
      const { data, error } = await admin.rpc("claim_automated_operation", {
        operation_id: ticket.id,
        lease: plan.lease,
      });
      if (error)
        throw new AppError(
          "AUTOMATION_CLAIM_REJECTED",
          "Automatic execution no longer has valid authority.",
          409,
        );
      return data as MarketTicket;
    },
    write: (change, id) =>
      client.writeMarketplace(change, id, async () => {
        const { error } = await admin.rpc("assert_automation_authority", {
          operation_id: ticket.id,
          lease: plan.lease,
        });
        if (error)
          throw new AppError(
            "ELDORADO_WRITE_NOT_SENT",
            "Automatic authority was revoked or expired. No marketplace request was sent.",
            409,
          );
      }),
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
          "The automatic result needs reconciliation; do not submit the change again.",
          503,
        );
      return data as MarketTicket;
    },
  };
}
async function executeAutomaticTicket(id: string, plan: Plan) {
  const { data, error } = await supabaseAdmin()
    .from("approval_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data)
    throw new AppError(
      "AUTOMATIC_TICKET_UNAVAILABLE",
      "The queued operation could not be loaded.",
      503,
    );
  const ticket = data as MarketTicket;
  const result = await executeMarketTicket(
    ticket,
    automatedDependencies(ticket, plan),
    ["executing", "blocked"].includes(ticket.status),
  );
  if (["executing", "blocked"].includes(result.operation.status))
    await supabaseAdmin()
      .from("approval_requests")
      .update({
        result: {
          ...result.operation.result,
          automationNextCheckAt: new Date(Date.now() + 300000).toISOString(),
        },
      })
      .eq("id", ticket.id)
      .in("status", ["executing", "blocked"]);
  return result;
}
export async function runHostedWorker() {
  const admin = supabaseAdmin(),
    started = Date.now();
  const { data: raw, error } = await admin.rpc("claim_automation_tick");
  if (error)
    throw new AppError(
      "WORKER_CLAIM_FAILED",
      "The worker lease could not be acquired.",
      503,
    );
  if (!raw)
    return {
      mode: "skipped",
      reason: "disabled_busy_backoff_or_revoked",
      upstreamWrites: 0,
    };
  const plan = raw as Plan;
  let failure: string | null = null,
    retry = 60;
  const results: Record<string, unknown> = {};
  try {
    if (plan.pollDue) results.poll = await pollOrders(plan);
    if (Date.now() - started < 25000) {
      if (plan.operationId) {
        const result = await executeAutomaticTicket(plan.operationId, plan);
        results.operation = {
          id: result.operation.id,
          status: result.operation.status,
        };
      } else if (plan.policy) {
        const policy = plan.policy;
        try {
          const calculation = await buildPricingQuote(policy),
            quote = await persistQuote(policy, policy.created_by, calculation);
          if (calculation.amount === calculation.before.price)
            results.pricing = { policyId: policy.id, status: "no_change" };
          else {
            const { data: ticket, error: createError } = await admin.rpc(
              "begin_automatic_repricing",
              { quote_id: quote.id, lease: plan.lease },
            );
            if (createError)
              throw new AppError(
                "AUTOMATIC_QUOTE_REJECTED",
                "The automatic quote changed or lost its scoped approval.",
                409,
              );
            const result = await executeAutomaticTicket(
              (ticket as MarketTicket).id,
              plan,
            );
            results.operation = {
              id: result.operation.id,
              status: result.operation.status,
            };
          }
          await admin
            .from("repricing_policies")
            .update({
              last_checked_at: new Date().toISOString(),
              next_run_at: new Date(
                Date.now() + policy.interval_seconds * 1000,
              ).toISOString(),
              last_error_code: null,
            })
            .eq("id", policy.id)
            .eq("version", policy.version);
        } catch (error) {
          const code =
            error instanceof AppError ? error.code : "PRICING_CHECK_FAILED";
          await admin
            .from("repricing_policies")
            .update({
              last_checked_at: new Date().toISOString(),
              next_run_at: new Date(
                Date.now() + Math.max(60, policy.interval_seconds) * 1000,
              ).toISOString(),
              last_error_code: code,
            })
            .eq("id", policy.id)
            .eq("version", policy.version);
          throw error;
        }
      }
    }
    return { mode: "run", results };
  } catch (error) {
    failure = error instanceof AppError ? error.code : "WORKER_FAILED";
    retry =
      error instanceof AppError
        ? Math.min(2147483647, Math.max(60, Math.ceil(error.retryAfter ?? 300)))
        : 300;
    throw error;
  } finally {
    const { error: releaseError } = await admin.rpc("release_automation_tick", {
      lease: plan.lease,
      failure_code: failure,
      retry_seconds: retry,
    });
    if (releaseError)
      console.error(JSON.stringify({ event: "worker_release_pending" }));
  }
}
