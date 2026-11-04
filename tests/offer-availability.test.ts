import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { EldoradoClient } from "@/domains/eldorado/client";
import {
  availabilityInputSchema,
  executeOfferAvailability,
  reconcileOfferAvailability,
  type AvailabilityDependencies,
  type AvailabilityOperation,
} from "@/domains/offers/availability";
import type { OfferRecord } from "@/domains/offers/schemas";

const timestamp = "2026-11-02T12:00:00Z";
const id = "11111111-1111-4111-8111-111111111111";
const fixture: AvailabilityOperation = {
  id,
  actor_id: "22222222-2222-4222-8222-222222222222",
  actor_session_id: "33333333-3333-4333-8333-333333333333",
  offer_id: "flexible:listing-fixture",
  source: "flexible",
  native_id: "listing-fixture",
  action: "pause",
  reason: "Synthetic stock review",
  before_state: "Active",
  observed_state: null,
  status: "running",
  expected_snapshot: timestamp,
  idempotency_key: "44444444-4444-4444-8444-444444444444",
  external_attempted: false,
  error_code: null,
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: null,
};
const listing: OfferRecord = {
  id: fixture.offer_id,
  native_id: fixture.native_id,
  source: "flexible",
  category: "Account",
  title: "Synthetic listing",
  state: "Active",
  price: 10,
  currency: "USD",
  quantity: 1,
  game_id: "fixture",
  updated_at: timestamp,
};
const input = {
  offerId: fixture.offer_id,
  action: "pause" as const,
  expectedSnapshot: timestamp,
  reason: fixture.reason,
  idempotencyKey: fixture.idempotency_key,
  confirm: true as const,
};
function dependencies(overrides: Partial<AvailabilityOperation> = {}) {
  let current = { ...fixture, ...overrides };
  const adapter = {
    begin: vi.fn(async () => ({ operation: { ...current }, reused: false })),
    read: vi.fn(async () => [{ ...listing }]),
    authorize: vi.fn(async () => {
      current.external_attempted = true;
    }),
    write: vi.fn(async () => undefined),
    finish: vi.fn<AvailabilityDependencies["finish"]>(
      async (_operation, status, observed, errorCode) => {
        current = {
          ...current,
          status,
          observed_state: observed,
          error_code: errorCode,
        };
        return { ...current };
      },
    ),
  } satisfies AvailabilityDependencies;
  return adapter;
}

describe("confirmed individual listing availability", () => {
  it("requires explicit confirmation, a snapshot, a private-safe identifier and a useful reason", () => {
    expect(availabilityInputSchema.parse(input)).toEqual(input);
    for (const change of [
      { confirm: false },
      { reason: "short" },
      { expectedSnapshot: "yesterday" },
      { offerId: "https://attacker.example/secret" },
      { offerId: "items:../listing" },
      { idempotencyKey: "not-a-uuid" },
      { action: "delete" },
      { secret: "unexpected" },
    ])
      expect(
        availabilityInputSchema.safeParse({ ...input, ...change }).success,
      ).toBe(false);
  });
  it("verifies the fresh state, claims once, writes once and verifies the resulting state", async () => {
    const deps = dependencies();
    deps.read
      .mockResolvedValueOnce([{ ...listing }])
      .mockResolvedValueOnce([{ ...listing, state: "Paused" }]);
    const result = await executeOfferAvailability(input, deps);
    expect(result.operation.status).toBe("succeeded");
    expect(result.operation.external_attempted).toBe(true);
    expect(deps.authorize).toHaveBeenCalledOnce();
    expect(deps.write).toHaveBeenCalledExactlyOnceWith(
      "flexible",
      listing.native_id,
      "pause",
    );
    expect(deps.read).toHaveBeenCalledTimes(2);
  });
  it("can verify a specific listing without returning private details or relying on a listing page", async () => {
    const deps = dependencies();
    const state = vi
      .fn<NonNullable<AvailabilityDependencies["state"]>>()
      .mockResolvedValueOnce({ state: "Active" })
      .mockResolvedValueOnce({ state: "Paused" });
    const result = await executeOfferAvailability(input, { ...deps, state });
    expect(result.operation.status).toBe("succeeded");
    expect(state).toHaveBeenCalledTimes(2);
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.finish).toHaveBeenCalledWith(
      expect.anything(),
      "succeeded",
      "Paused",
      null,
      undefined,
    );
  });
  it("returns a durable replay without reading or dispatching another upstream write", async () => {
    const deps = dependencies({ status: "unknown", external_attempted: true });
    deps.begin.mockResolvedValue({
      operation: { ...fixture, status: "unknown", external_attempted: true },
      reused: true,
    });
    expect((await executeOfferAvailability(input, deps)).reused).toBe(true);
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("records an already desired state without dispatching a change", async () => {
    const deps = dependencies();
    deps.read.mockResolvedValue([{ ...listing, state: "Paused" }]);
    const result = await executeOfferAvailability(input, deps);
    expect(result.operation.status).toBe("succeeded");
    expect(result.operation.error_code).toBe("ALREADY_DESIRED_STATE");
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("does not write when the listing is outside the verified page or has an unsupported state", async () => {
    const missing = dependencies();
    missing.read.mockResolvedValue([]);
    expect(
      (await executeOfferAvailability(input, missing)).operation.error_code,
    ).toBe("OFFER_NOT_VERIFIABLE");
    const changed = dependencies();
    changed.read.mockResolvedValue([{ ...listing, state: "Deleted" }]);
    expect(
      (await executeOfferAvailability(input, changed)).operation.status,
    ).toBe("rejected");
    expect(missing.write).not.toHaveBeenCalled();
    expect(changed.write).not.toHaveBeenCalled();
  });
  it("stops before writing when staff access is revoked after preflight", async () => {
    const deps = dependencies();
    deps.authorize.mockRejectedValue(new Error("revoked"));
    expect(
      (await executeOfferAvailability(input, deps)).operation.error_code,
    ).toBe("EXECUTION_NOT_AUTHORIZED");
    expect(deps.write).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain write and retains uncertainty until a read confirms the desired state", async () => {
    const deps = dependencies();
    deps.write.mockRejectedValue(new Error("private transport information"));
    const result = await executeOfferAvailability(input, deps);
    expect(result.operation.status).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain(
      "private transport information",
    );
    expect(deps.write).toHaveBeenCalledOnce();
    const pending = await reconcileOfferAvailability(
      result.operation,
      deps,
      Date.parse(timestamp) + 180000,
    );
    expect(pending.operation.status).toBe("unknown");
    deps.read.mockResolvedValue([{ ...listing, state: "Paused" }]);
    expect(
      (await reconcileOfferAvailability(pending.operation, deps)).operation
        .status,
    ).toBe("succeeded");
    expect(deps.write).toHaveBeenCalledOnce();
  });
  it("treats an accepted write with a missing or unchanged post-read as unknown", async () => {
    const deps = dependencies();
    const result = await executeOfferAvailability(input, deps);
    expect(result.operation.status).toBe("unknown");
    expect(result.operation.error_code).toBe("STATE_NOT_CONFIRMED");
    expect(deps.write).toHaveBeenCalledOnce();
  });
  it("records an explicit upstream rejection without retrying", async () => {
    const deps = dependencies();
    deps.write.mockRejectedValue(
      new AppError("ELDORADO_WRITE_REJECTED", "Rejected", 502),
    );
    expect((await executeOfferAvailability(input, deps)).operation.status).toBe(
      "rejected",
    );
    expect(deps.write).toHaveBeenCalledOnce();
  });
  it("does not race a running request, and closes an old request only when execution was never claimed", async () => {
    const deps = dependencies();
    expect(
      (
        await reconcileOfferAvailability(
          fixture,
          deps,
          Date.parse(timestamp) + 1000,
        )
      ).operation.status,
    ).toBe("running");
    expect(deps.read).not.toHaveBeenCalled();
    expect(
      (
        await reconcileOfferAvailability(
          fixture,
          deps,
          Date.parse(timestamp) + 180000,
        )
      ).operation.error_code,
    ).toBe("NO_EXTERNAL_ATTEMPT");
    expect(deps.write).not.toHaveBeenCalled();
  });
});

describe("restricted Eldorado availability transport", () => {
  it("respects an upstream cooldown and authenticates a future explicit action after401 without replaying the rejected action", async () => {
    let now = 0;
    let writes = 0;
    let authentications = 0;
    const client = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      async (url) => {
        if (String(url).endsWith("/token")) {
          authentications++;
          return Response.json({
            accessToken: "fixture-token",
            expiresIn: 900,
          });
        }
        writes++;
        if (writes === 1)
          return new Response(null, {
            status: 429,
            headers: { "Retry-After": "5" },
          });
        if (writes === 2) return new Response(null, { status: 401 });
        return new Response(null, { status: 204 });
      },
      () => now,
    );
    await expect(
      client.setOfferAvailability("items", "listing", "pause"),
    ).rejects.toMatchObject({ code: "ELDORADO_WRITE_REJECTED" });
    await expect(
      client.setOfferAvailability("items", "listing", "pause"),
    ).rejects.toMatchObject({ code: "ELDORADO_WRITE_NOT_SENT" });
    expect(writes).toBe(1);
    now = 5001;
    await expect(
      client.setOfferAvailability("items", "listing", "pause"),
    ).rejects.toMatchObject({ code: "ELDORADO_WRITE_REJECTED" });
    expect(writes).toBe(2);
    expect(authentications).toBe(1);
    await client.setOfferAvailability("items", "listing", "pause");
    expect(writes).toBe(3);
    expect(authentications).toBe(2);
  });

  it("uses only the documented method/path and accepts an empty204 without assuming state success", async () => {
    for (const [source, method, path] of [
      ["flexible", "PUT", "/api/flexibleOffersUser/me/listing-fixture/pause"],
      [
        "predefined",
        "PUT",
        "/api/predefinedOffersUser/me/listing-fixture/pause",
      ],
      [
        "items",
        "POST",
        "/api/v1/item-management/me/offers/listing-fixture/pause",
      ],
      [
        "currency",
        "PUT",
        "/api/v1/currency-management/me/offers/listing-fixture/pause",
      ],
    ] as const) {
      let writes = 0;
      const client = new EldoradoClient(
        { clientId: "fixture", clientSecret: "fixture" },
        async (url, options) => {
          if (String(url).endsWith("/token"))
            return Response.json({
              accessToken: "fixture-token",
              expiresIn: 900,
            });
          writes++;
          expect(String(url)).toBe("https://www.eldorado.gg" + path);
          expect(options?.method).toBe(method);
          expect(options?.redirect).toBe("error");
          expect(options?.body).toBeUndefined();
          return new Response(null, { status: 204 });
        },
      );
      await client.setOfferAvailability(source, "listing-fixture", "pause");
      expect(writes).toBe(1);
    }
  });
  it("rejects arbitrary targets before authentication and never retries a401 write", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/token")
        ? Response.json({ accessToken: "fixture-token", expiresIn: 900 })
        : new Response("private body", { status: 401 }),
    );
    const client = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      fetcher,
    );
    await expect(
      client.setOfferAvailability("items", "../arbitrary", "pause"),
    ).rejects.toMatchObject({ code: "INVALID_AVAILABILITY_TARGET" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      client.setOfferAvailability("items", "listing", "resume"),
    ).rejects.toMatchObject({ code: "ELDORADO_WRITE_REJECTED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("distinguishes unattempted authentication failure from ambiguous gateway or connection failure", async () => {
    const denied = new EldoradoClient(
      { clientId: "fixture", clientSecret: "fixture" },
      async () => new Response(null, { status: 403 }),
    );
    await expect(
      denied.setOfferAvailability("items", "listing", "pause"),
    ).rejects.toMatchObject({ code: "ELDORADO_WRITE_NOT_SENT" });
    for (const status of [408, 500, 504]) {
      const fetcher = vi.fn<typeof fetch>(async (url) =>
        String(url).endsWith("/token")
          ? Response.json({ accessToken: "fixture-token", expiresIn: 900 })
          : new Response("private failure", { status }),
      );
      const client = new EldoradoClient(
        { clientId: "fixture", clientSecret: "fixture" },
        fetcher,
      );
      await expect(
        client.setOfferAvailability("items", "listing", "pause"),
      ).rejects.toMatchObject({ code: "ELDORADO_WRITE_UNKNOWN" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
});
