/** Public operational metadata only. Never pass provider bodies or credentials here. */
export type IntegrationIssue = {
  code: string;
  title: string;
  action: string;
};

export function integrationIssue(
  value: string | null | undefined,
): IntegrationIssue {
  const code =
    value && /^[A-Z][A-Z0-9_]{1,79}$/.test(value)
      ? value
      : "INTEGRATION_CHECK_FAILED";
  if (
    [
      "ELDORADO_AUTH_REJECTED",
      "ELDORADO_ACCESS_EXPIRED",
      "ELDORADO_AUTH_FAILED",
      "INTEGRATION_ACCOUNT_MISMATCH",
      "INTEGRATION_INTEGRITY_ERROR",
    ].includes(code)
  )
    return {
      code,
      title: "Seller authentication needs attention",
      action:
        "The Owner should verify or reconnect Eldorado in Settings. Keep existing uncertain operations for outcome checks.",
    };
  if (code === "ELDORADO_ACCESS_DENIED")
    return {
      code,
      title: "Eldorado denied this read",
      action:
        "Check Seller API eligibility and account restrictions on Eldorado. Repeated refreshes will not restore permission.",
    };
  if (["ELDORADO_RATE_LIMITED", "RATE_GATE_UNAVAILABLE"].includes(code))
    return {
      code,
      title:
        code === "ELDORADO_RATE_LIMITED"
          ? "Provider cooldown is active"
          : "Shared cooldown cannot be checked",
      action:
        "Wait for the recorded cooldown before another read. If the cooldown store is unavailable, ask the Owner to check database health.",
    };
  if (
    ["INTEGRATION_NOT_CONFIGURED", "ENCRYPTION_NOT_CONFIGURED"].includes(code)
  )
    return {
      code,
      title: "Seller connection is incomplete",
      action:
        "Ask the Owner to finish the secure connection in Settings and verify it from this hosted server.",
    };
  if (["UPSTREAM_CONTRACT", "ELDORADO_READ_NOT_FOUND"].includes(code))
    return {
      code,
      title: "The documented read could not be verified",
      action:
        "Keep the current local snapshot. Ask an administrator to review the API contract before retrying or making a change.",
    };
  if (
    code === "SCHEDULER_HTTP_401" ||
    code === "SCHEDULER_HTTP_403" ||
    code === "SCHEDULER_CREDENTIAL_MISSING"
  )
    return {
      code,
      title: "The scheduler is not authorized",
      action:
        "Ask an administrator to check the private scheduler authorization. Do not paste credentials into this page.",
    };
  if (
    code === "SCHEDULER_HTTP_404" ||
    code === "SCHEDULER_CONFIGURATION_INVALID"
  )
    return {
      code,
      title: "The scheduler destination needs attention",
      action:
        "Ask an administrator to verify the configured production worker route and deployment.",
    };
  if (code.startsWith("SCHEDULER_"))
    return {
      code,
      title: "The scheduler could not confirm a successful dispatch",
      action:
        "Check the production worker deployment and scheduler status. Check existing operation outcomes before requesting any commercial action again.",
    };
  if (
    code.includes("PERSISTENCE") ||
    code.includes("STORE") ||
    code.includes("CURSOR_SAVE")
  )
    return {
      code,
      title: "Local integration storage needs attention",
      action:
        "Ask an administrator to check the database and migration status. Existing commercial operations must be reconciled before resubmission.",
    };
  if (
    [
      "ELDORADO_UNREACHABLE",
      "ELDORADO_SERVICE_UNAVAILABLE",
      "CONNECTION_FAILED",
    ].includes(code)
  )
    return {
      code,
      title: "Eldorado could not be reached reliably",
      action:
        "Keep the current local snapshot and retry a read later. Check outcomes for any already-issued commercial action.",
    };
  return {
    code,
    title: "An integration check needs attention",
    action:
      "Refresh a read after reviewing connection and scheduler health. Check the existing operation outcome before submitting another commercial action.",
  };
}

type SyncRow = {
  provider: string;
  last_success_at: string | null;
  cursor?: string | null;
  scope?: string | null;
};
type ErrorRow = { provider: string; code: string; created_at: string };
const sources = [
  ["eldorado", "Sold orders"],
  ["eldorado-offers:predefined", "Predefined offers"],
  ["eldorado-offers:flexible", "Flexible offers"],
  ["eldorado-offers:items", "Item offers"],
  ["eldorado-offers:currency", "Currency offers"],
] as const;
function timestamp(value: string | null | undefined) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function pageMetadata(value: string | null | undefined) {
  try {
    const page: unknown = JSON.parse(value ?? "null");
    if (!page || typeof page !== "object") return null;
    const record = page as Record<string, unknown>;
    const number = (key: string, min: number) =>
      typeof record[key] === "number" &&
      Number.isSafeInteger(record[key]) &&
      Number(record[key]) >= min
        ? Number(record[key])
        : null;
    const index = number("index", 1),
      totalPages = number("totalPages", 0),
      size = number("size", 1),
      recordCount = number("recordCount", 0);
    return index !== null &&
      totalPages !== null &&
      size !== null &&
      recordCount !== null
      ? { index, totalPages, size, recordCount }
      : null;
  } catch {
    return null;
  }
}
export function integrationSnapshot(
  sync: SyncRow[],
  errors: ErrorRow[],
  checkedAt = new Date().toISOString(),
) {
  return {
    checkedAt,
    sources: sources.map(([provider, label]) => {
      const row = sync.find((entry) => entry.provider === provider);
      const lastSuccessAt = timestamp(row?.last_success_at);
      const failure = errors
        .filter(
          (entry) => entry.provider === provider && timestamp(entry.created_at),
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      const lastErrorAt = timestamp(failure?.created_at);
      const needsAttention =
        !!lastErrorAt && (!lastSuccessAt || lastErrorAt > lastSuccessAt);
      return {
        provider,
        label,
        lastSuccessAt,
        // These adapters persist individual pages, not a proven full-account crawl.
        scope: "partial" as const,
        state: needsAttention
          ? ("attention" as const)
          : lastSuccessAt
            ? ("saved" as const)
            : ("not_synced" as const),
        page: provider === "eldorado" ? null : pageMetadata(row?.cursor),
        hasNextPage: provider === "eldorado" ? !!row?.cursor : null,
        issue:
          needsAttention && failure ? integrationIssue(failure.code) : null,
        lastErrorAt,
      };
    }),
  };
}
export type IntegrationSnapshot = ReturnType<typeof integrationSnapshot>;

export type AutomationRuntimeHealth = {
  scheduler_configured: boolean;
  scheduler_job_active: boolean | null;
  authority_valid: boolean;
  due_work: boolean;
  leased_until: string | null;
  last_heartbeat_at: string | null;
  last_poll_at: string | null;
  last_error_code: string | null;
  backoff_until: string | null;
  provider_backoff_until: string | null;
  last_dispatch_at: string | null;
  last_dispatch_status: number | null;
  pending_backfill_pages: number;
};
type AutomationSwitches = {
  pollEnabled: boolean;
  autoDeliveryEnabled: boolean;
  autoPricingEnabled: boolean;
};
export function schedulerHealth(
  runtime: AutomationRuntimeHealth | null,
  settings: AutomationSwitches,
  now = Date.now(),
) {
  const state = (status: string, label: string, action: string) => ({
    status,
    label,
    action,
  });
  if (!runtime)
    return state(
      "unavailable",
      "Status unavailable",
      "The runtime could not be checked. Refresh later or ask an administrator to check database health.",
    );
  if (
    !settings.pollEnabled &&
    !settings.autoDeliveryEnabled &&
    !settings.autoPricingEnabled
  )
    return state(
      "disabled",
      "Disabled by Owner",
      "All background switches are off. No background traffic is requested.",
    );
  if (!runtime.scheduler_configured || runtime.scheduler_job_active === false)
    return state(
      "not_configured",
      runtime.scheduler_job_active === false
        ? "Scheduler job inactive"
        : "Scheduler configuration required",
      "Ask an administrator to verify the hosted scheduler. This page does not activate it.",
    );
  if (runtime.scheduler_job_active === null)
    return state(
      "unverified",
      "Scheduler job unverified",
      "A saved scheduler configuration exists, but its job could not be verified. Ask an administrator to check the provider scheduler.",
    );
  if (!runtime.authority_valid)
    return state(
      "unauthorized",
      "Owner authorization inactive",
      "An active Owner must review and save workspace authorization. Revoked sessions cannot run background work.",
    );
  if (
    (runtime.backoff_until && Date.parse(runtime.backoff_until) > now) ||
    runtime.provider_backoff_until === "infinity" ||
    (runtime.provider_backoff_until &&
      Date.parse(runtime.provider_backoff_until) > now)
  )
    return state(
      "cooldown",
      "Waiting for cooldown",
      "The worker is waiting for the recorded retry time. Do not bypass provider backoff.",
    );
  if (runtime.leased_until && Date.parse(runtime.leased_until) > now)
    return state(
      "running",
      "Worker lease active",
      "A worker holds the current lease. An uncertain write will only be reconciled.",
    );
  if (runtime.last_error_code) {
    const issue = integrationIssue(runtime.last_error_code);
    return state("attention", issue.title, issue.action);
  }
  if (
    runtime.last_dispatch_status !== null &&
    (runtime.last_dispatch_status < 200 || runtime.last_dispatch_status >= 300)
  ) {
    const issue = integrationIssue(
      "SCHEDULER_HTTP_" + runtime.last_dispatch_status,
    );
    return state("attention", issue.title, issue.action);
  }
  const heartbeat = runtime.last_heartbeat_at
    ? Date.parse(runtime.last_heartbeat_at)
    : NaN;
  const lastDispatch = runtime.last_dispatch_at
    ? Date.parse(runtime.last_dispatch_at)
    : NaN;
  if (
    runtime.due_work &&
    (!Number.isFinite(heartbeat) || now - heartbeat > 180000) &&
    (!Number.isFinite(lastDispatch) || now - lastDispatch > 180000)
  )
    return state(
      "overdue",
      "Due work needs a heartbeat",
      "Work is due and no recent worker activity is recorded. Ask an administrator to check the scheduler and production worker.",
    );
  return runtime.due_work
    ? state(
        "scheduled",
        "Work scheduled",
        "Due work is waiting for the next authorized scheduler pass.",
      )
    : state(
        "idle",
        "Waiting for work",
        "No authorized work is due. An older heartbeat is expected while the service is idle.",
      );
}
export type SchedulerHealth = ReturnType<typeof schedulerHealth>;

export function cooldownTime(value: string) {
  return value === "infinity"
    ? "Owner review required"
    : Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString("en-US")
      : "Time unavailable";
}
