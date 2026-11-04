import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { eldoradoClient } from "@/domains/eldorado/client";
import type { requireStaff } from "@/domains/authentication/session";
import { offerSources, type OfferSource } from "./definitions";
import type { OfferRecord } from "./schemas";
import { readSellerOfferPage } from "./service";

export const availabilityInputSchema = z
  .object({
    offerId: z
      .string()
      .regex(/^(flexible|predefined|items|currency):[A-Za-z0-9_-]{1,150}$/),
    action: z.enum(["pause", "resume"]),
    expectedSnapshot: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(10).max(1000),
    idempotencyKey: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();
export type AvailabilityInput = z.infer<typeof availabilityInputSchema>;

export const availabilityOperationSchema = z.object({
  id: z.uuid(),
  actor_id: z.uuid(),
  actor_session_id: z.uuid(),
  offer_id: z.string(),
  source: z.enum(offerSources),
  native_id: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  action: z.enum(["pause", "resume"]),
  reason: z.string(),
  before_state: z.string(),
  observed_state: z.string().nullable(),
  status: z.enum(["running", "succeeded", "failed", "unknown", "rejected"]),
  expected_snapshot: z.string(),
  idempotency_key: z.uuid(),
  external_attempted: z.boolean(),
  error_code: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
});
export type AvailabilityOperation = z.infer<typeof availabilityOperationSchema>;
type Outcome = "succeeded" | "failed" | "unknown" | "rejected";
type CurrentAvailability = { state: string; snapshot?: OfferRecord };
export type AvailabilityDependencies = {
  begin(
    input: AvailabilityInput,
  ): Promise<{ operation: AvailabilityOperation; reused: boolean }>;
  read(source: OfferSource): Promise<OfferRecord[]>;
  state?(
    operation: AvailabilityOperation,
  ): Promise<CurrentAvailability | undefined>;
  authorize(operation: AvailabilityOperation): Promise<void>;
  write(
    source: OfferSource,
    nativeId: string,
    action: "pause" | "resume",
  ): Promise<void>;
  finish(
    operation: AvailabilityOperation,
    status: Outcome,
    observed: string | null,
    errorCode: string | null,
    snapshot?: OfferRecord,
  ): Promise<AvailabilityOperation>;
};

export function availabilityResult(
  operation: AvailabilityOperation,
  reused = false,
) {
  const message =
    operation.status === "succeeded"
      ? operation.external_attempted
        ? "The listing's current availability was verified with Eldorado."
        : "The listing already has the requested availability. No external change was sent."
      : operation.status === "unknown"
        ? "The result is not confirmed. No retry has been sent. Use Check status before taking another action."
        : operation.status === "running"
          ? "The request is recorded and still pending. Check its status; do not submit another change."
          : "This change was not completed. Refresh the listing and review the recorded result before confirming a new request.";
  return { operation, reused, message };
}

const desiredState = (action: AvailabilityOperation["action"]) =>
  action === "pause" ? "Paused" : "Active";
const permittedBeforeState = (action: AvailabilityOperation["action"]) =>
  action === "pause" ? "Active" : "Paused";

async function readCurrentAvailability(
  operation: AvailabilityOperation,
  dependencies: AvailabilityDependencies,
): Promise<CurrentAvailability | undefined> {
  if (dependencies.state) return dependencies.state(operation);
  const snapshot = (await dependencies.read(operation.source)).find(
    (row) =>
      row.id === operation.offer_id && row.native_id === operation.native_id,
  );
  return snapshot ? { state: snapshot.state, snapshot } : undefined;
}

/** A replay only returns its durable record. It never causes another upstream write. */
export async function executeOfferAvailability(
  input: AvailabilityInput,
  dependencies: AvailabilityDependencies,
) {
  const started = await dependencies.begin(input);
  const operation = started.operation;
  if (started.reused) return availabilityResult(operation, true);
  let fresh: CurrentAvailability | undefined;
  try {
    fresh = await readCurrentAvailability(operation, dependencies);
  } catch {
    return availabilityResult(
      await dependencies.finish(
        operation,
        "failed",
        null,
        "PREFLIGHT_READ_FAILED",
      ),
    );
  }
  if (!fresh)
    return availabilityResult(
      await dependencies.finish(
        operation,
        "failed",
        null,
        "OFFER_NOT_VERIFIABLE",
      ),
    );
  if (fresh.state === desiredState(operation.action))
    return availabilityResult(
      await dependencies.finish(
        operation,
        "succeeded",
        fresh.state,
        "ALREADY_DESIRED_STATE",
        fresh.snapshot,
      ),
    );
  if (
    fresh.state !== permittedBeforeState(operation.action) ||
    operation.before_state !== permittedBeforeState(operation.action)
  )
    return availabilityResult(
      await dependencies.finish(
        operation,
        "rejected",
        fresh.state,
        "OFFER_STATE_CHANGED",
        fresh.snapshot,
      ),
    );
  try {
    // The DB atomically checks current membership/session/permissions and claims
    // this operation once. A revoked or already claimed request cannot send.
    await dependencies.authorize(operation);
  } catch {
    return availabilityResult(
      await dependencies.finish(
        operation,
        "failed",
        fresh.state,
        "EXECUTION_NOT_AUTHORIZED",
      ),
    );
  }
  try {
    await dependencies.write(
      operation.source,
      operation.native_id,
      operation.action,
    );
  } catch (error) {
    const code =
      error instanceof AppError ? error.code : "ELDORADO_WRITE_UNKNOWN";
    const rejected =
      code === "ELDORADO_WRITE_REJECTED" || code === "ELDORADO_WRITE_NOT_SENT";
    return availabilityResult(
      await dependencies.finish(
        operation,
        rejected ? "rejected" : "unknown",
        null,
        rejected ? code : "ELDORADO_WRITE_UNKNOWN",
      ),
    );
  }
  try {
    fresh = await readCurrentAvailability(operation, dependencies);
  } catch {
    return availabilityResult(
      await dependencies.finish(
        operation,
        "unknown",
        null,
        "POST_WRITE_READ_FAILED",
      ),
    );
  }
  if (fresh?.state === desiredState(operation.action))
    return availabilityResult(
      await dependencies.finish(
        operation,
        "succeeded",
        fresh.state,
        null,
        fresh.snapshot,
      ),
    );
  return availabilityResult(
    await dependencies.finish(
      operation,
      "unknown",
      fresh?.state ?? null,
      "STATE_NOT_CONFIRMED",
    ),
  );
}

/** Only reads the upstream state. An uncertain write is never repeated here. */
export async function reconcileOfferAvailability(
  operation: AvailabilityOperation,
  dependencies: AvailabilityDependencies,
  now = Date.now(),
) {
  if (operation.status !== "unknown" && operation.status !== "running")
    return availabilityResult(operation, true);
  if (
    operation.status === "running" &&
    now - Date.parse(operation.created_at) < 120_000
  )
    return availabilityResult(operation, true);
  let fresh: CurrentAvailability | undefined;
  try {
    fresh = await readCurrentAvailability(operation, dependencies);
  } catch {
    return availabilityResult(
      await dependencies.finish(
        operation,
        "unknown",
        null,
        "RECONCILIATION_READ_FAILED",
      ),
      true,
    );
  }
  if (fresh?.state === desiredState(operation.action))
    return availabilityResult(
      await dependencies.finish(
        operation,
        "succeeded",
        fresh.state,
        "RECONCILED_BY_READ",
        fresh.snapshot,
      ),
      true,
    );
  if (operation.status === "running" && !operation.external_attempted)
    return availabilityResult(
      await dependencies.finish(
        operation,
        "failed",
        fresh?.state ?? null,
        "NO_EXTERNAL_ATTEMPT",
        fresh?.snapshot,
      ),
      true,
    );
  return availabilityResult(
    await dependencies.finish(
      operation,
      "unknown",
      fresh?.state ?? null,
      "STATE_NOT_CONFIRMED",
    ),
    true,
  );
}

export function availabilityDependencies(
  staff: Awaited<ReturnType<typeof requireStaff>>,
): AvailabilityDependencies {
  const finishDb = supabaseAdmin();
  return {
    async begin(input) {
      const { data, error } = await staff.db.rpc("begin_offer_availability", {
        offer_key: input.offerId,
        desired_action: input.action,
        expected_snapshot: input.expectedSnapshot,
        request_key: input.idempotencyKey,
        justification: input.reason,
      });
      if (error) {
        if (error.code === "42501")
          throw new AppError(
            "FORBIDDEN",
            "Your current staff access does not permit this listing change.",
            403,
          );
        if (error.code === "P0001")
          throw new AppError(
            "RATE_LIMITED",
            "Wait before requesting another listing change.",
            429,
          );
        if (error.code === "P0002")
          throw new AppError(
            "NOT_FOUND",
            "This listing is no longer available.",
            404,
          );
        throw new AppError(
          "AVAILABILITY_CONFLICT",
          "This listing changed or has a pending operation. Refresh it and check the operation history before trying again.",
          409,
        );
      }
      return z
        .object({ operation: availabilityOperationSchema, reused: z.boolean() })
        .parse(data);
    },
    async read(source) {
      return (await readSellerOfferPage(source)).items;
    },
    async state(operation) {
      if (operation.source !== "items") {
        const current = await eldoradoClient().offerState(
          operation.source,
          operation.native_id,
        );
        return { state: current.state };
      }
      const snapshot = (await readSellerOfferPage(operation.source)).items.find(
        (row) =>
          row.id === operation.offer_id &&
          row.native_id === operation.native_id,
      );
      return snapshot ? { state: snapshot.state, snapshot } : undefined;
    },
    async authorize(operation) {
      const { error } = await staff.db.rpc(
        "assert_offer_availability_execution",
        { operation_id: operation.id },
      );
      if (error)
        throw new AppError(
          "FORBIDDEN",
          "This operation is no longer permitted.",
          403,
        );
    },
    async write(source, nativeId, action) {
      await eldoradoClient().setOfferAvailability(source, nativeId, action);
    },
    async finish(operation, status, observed, errorCode, snapshot) {
      const { data, error } = await finishDb.rpc("finish_offer_availability", {
        operation_id: operation.id,
        outcome: status,
        observed,
        failure_code: errorCode,
        snapshot: snapshot ?? null,
      });
      if (error)
        throw new AppError(
          "AVAILABILITY_RECORD_PENDING",
          "The result could not be recorded. Check this operation's status; do not submit another change.",
          503,
        );
      return availabilityOperationSchema.parse(data);
    },
  };
}
