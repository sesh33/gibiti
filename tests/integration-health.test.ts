import { describe, expect, it } from "vitest";
import {
  integrationIssue,
  integrationSnapshot,
  schedulerHealth,
  type AutomationRuntimeHealth,
} from "@/domains/eldorado/integration-health";

const now = Date.parse("2026-11-15T12:00:00Z");
const switches = {
  pollEnabled: false,
  autoDeliveryEnabled: false,
  autoPricingEnabled: true,
};
function runtime(
  patch: Partial<AutomationRuntimeHealth> = {},
): AutomationRuntimeHealth {
  return {
    scheduler_configured: true,
    scheduler_job_active: true,
    authority_valid: true,
    due_work: false,
    leased_until: null,
    last_heartbeat_at: "2026-11-14T00:00:00Z",
    last_poll_at: null,
    last_error_code: null,
    backoff_until: null,
    provider_backoff_until: null,
    last_dispatch_at: null,
    last_dispatch_status: null,
    pending_backfill_pages: 0,
    ...patch,
  };
}
describe("truthful local source health", () => {
  it("keeps independent partial pages, dates and next-cursor presence without exposing the cursor", () => {
    const result = integrationSnapshot(
      [
        {
          provider: "eldorado",
          last_success_at: "2026-11-15T11:00:00Z",
          cursor: "private-pagination-token",
          scope: "partial",
        },
        {
          provider: "eldorado-offers:predefined",
          last_success_at: "2026-11-15T11:30:00Z",
          cursor: JSON.stringify({
            index: 2,
            size: 50,
            totalPages: 5,
            recordCount: 210,
            private: "private-metadata",
          }),
          scope: "partial",
        },
      ],
      [],
    );
    expect(result.sources).toHaveLength(5);
    expect(result.sources[0]).toMatchObject({
      scope: "partial",
      state: "saved",
      hasNextPage: true,
      page: null,
    });
    expect(result.sources[1].page).toEqual({
      index: 2,
      size: 50,
      totalPages: 5,
      recordCount: 210,
    });
    expect(result.sources[2]).toMatchObject({
      state: "not_synced",
      lastSuccessAt: null,
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("only treats a later source failure as current and rejects malformed page metadata", () => {
    const result = integrationSnapshot(
      [
        { provider: "eldorado", last_success_at: "2026-11-15T11:00:00Z" },
        {
          provider: "eldorado-offers:predefined",
          last_success_at: "invalid",
          cursor: '{"index":"private-invalid-value"}',
        },
      ],
      [
        {
          provider: "eldorado",
          code: "ELDORADO_UNREACHABLE",
          created_at: "2026-11-15T10:00:00Z",
        },
        {
          provider: "eldorado-offers:predefined",
          code: "ELDORADO_ACCESS_DENIED",
          created_at: "2026-11-15T11:20:00Z",
        },
      ],
    );
    expect(result.sources[0]).toMatchObject({ state: "saved", issue: null });
    expect(result.sources[1]).toMatchObject({
      state: "attention",
      page: null,
      issue: { code: "ELDORADO_ACCESS_DENIED" },
    });
    expect(JSON.stringify(result)).not.toContain("private-invalid-value");
  });
  it("does not reflect arbitrary provider diagnostics as an operational code", () => {
    expect(
      integrationIssue("private diagnostic: Authorization secret").code,
    ).toBe("INTEGRATION_CHECK_FAILED");
    expect(integrationIssue("SCHEDULER_HTTP_401").action).toContain(
      "private scheduler authorization",
    );
    expect(integrationIssue("ELDORADO_RATE_LIMITED").action).toContain(
      "cooldown",
    );
  });
});
describe("scheduler operational states", () => {
  it("does not call an idle service unhealthy because its heartbeat is old", () => {
    expect(schedulerHealth(runtime(), switches, now).status).toBe("idle");
    expect(
      schedulerHealth(runtime({ due_work: true }), switches, now).status,
    ).toBe("overdue");
    expect(
      schedulerHealth(
        runtime({ due_work: true, last_heartbeat_at: "2026-11-15T11:59:50Z" }),
        switches,
        now,
      ).status,
    ).toBe("scheduled");
  });
  it("separates disabled, missing, inactive and unverified configuration from revoked authority", () => {
    expect(schedulerHealth(null, switches, now).status).toBe("unavailable");
    expect(
      schedulerHealth(
        runtime(),
        { ...switches, autoPricingEnabled: false },
        now,
      ).status,
    ).toBe("disabled");
    expect(
      schedulerHealth(runtime({ scheduler_configured: false }), switches, now)
        .status,
    ).toBe("not_configured");
    expect(
      schedulerHealth(runtime({ scheduler_job_active: false }), switches, now)
        .label,
    ).toBe("Scheduler job inactive");
    expect(
      schedulerHealth(runtime({ scheduler_job_active: null }), switches, now)
        .status,
    ).toBe("unverified");
    expect(
      schedulerHealth(runtime({ authority_valid: false }), switches, now)
        .status,
    ).toBe("unauthorized");
  });
  it("gives active cooldown and lease precedence over stale error history", () => {
    expect(
      schedulerHealth(
        runtime({ provider_backoff_until: "infinity" }),
        switches,
        now,
      ).status,
    ).toBe("cooldown");
    expect(
      schedulerHealth(
        runtime({
          backoff_until: "2026-11-15T12:01:00Z",
          last_error_code: "ELDORADO_RATE_LIMITED",
        }),
        switches,
        now,
      ).status,
    ).toBe("cooldown");
    expect(
      schedulerHealth(
        runtime({
          leased_until: "2026-11-15T12:00:20Z",
          last_error_code: "ELDORADO_UNREACHABLE",
        }),
        switches,
        now,
      ).status,
    ).toBe("running");
    expect(
      schedulerHealth(runtime({ last_dispatch_status: 401 }), switches, now),
    ).toMatchObject({
      status: "attention",
      label: "The scheduler is not authorized",
    });
  });
});
