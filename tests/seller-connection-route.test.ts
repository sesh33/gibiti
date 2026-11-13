import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
const mocked = vi.hoisted(() => ({
  staff: vi.fn(),
  rate: vi.fn(),
  save: vi.fn(),
  orders: vi.fn(),
  reset: vi.fn(),
  status: vi.fn(),
  health: vi.fn(),
}));
vi.mock("@/domains/authentication/session", () => ({
  requireStaff: mocked.staff,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ rpc: mocked.save }),
}));
vi.mock("@/domains/eldorado/client", () => ({
  EldoradoClient: class {
    orders = mocked.orders;
  },
  resetEldoradoClient: mocked.reset,
}));
vi.mock("@/domains/eldorado/health", () => ({
  readSellerHealth: mocked.health,
}));
vi.mock("@/domains/eldorado/credentials", async (original) => ({
  ...(await original<typeof import("@/domains/eldorado/credentials")>()),
  sellerConnectionStatus: mocked.status,
}));
import { POST, GET } from "@/app/api/integrations/eldorado/route";
import { POST as HEALTH } from "@/app/api/integrations/eldorado/health/route";
const origin = "https://rivox.example",
  secret = "synthetic-secret-value";
function request(body: unknown = { clientSecret: secret }, from = origin) {
  return new Request(origin + "/api/integrations/eldorado", {
    method: "POST",
    headers: { Origin: from, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("ELDORADO_CLIENT_ID", "fixture-client");
  vi.stubEnv("INVENTORY_ENCRYPTION_KEY", "1".repeat(64));
  mocked.staff.mockResolvedValue({
    user: { id: "fixture-owner" },
    sessionId: "fixture-session",
    profile: { role: "OWNER" },
    db: { rpc: mocked.rate },
  });
  mocked.rate.mockResolvedValue({ data: true });
  mocked.orders.mockResolvedValue({ results: [] });
  mocked.save.mockResolvedValue({ error: null });
  mocked.status.mockResolvedValue({
    configured: false,
    clientId: "fixture-client",
    verifiedAt: null,
  });
  mocked.health.mockResolvedValue({
    checks: [],
    checkedAt: "2026-11-13T03:00:00Z",
  });
});
afterEach(() => vi.unstubAllEnvs());
it("checks the real read adapter before atomically storing ciphertext and auditing", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = JSON.stringify(await response.json());
  expect(body).not.toContain(secret);
  expect(mocked.staff).toHaveBeenCalledWith("settings.manage");
  expect(mocked.orders).toHaveBeenCalledTimes(1);
  expect(mocked.save).toHaveBeenCalledWith(
    "save_seller_credentials",
    expect.objectContaining({
      actor: "fixture-owner",
      actor_session: "fixture-session",
      credential_client_id: "fixture-client",
      credential_envelope: expect.stringMatching(/^v1\./),
    }),
  );
  expect(JSON.stringify(mocked.save.mock.calls)).not.toContain(secret);
  expect(mocked.reset).toHaveBeenCalledOnce();
});
it("rejects a staff permission override unless the actual role is Owner", async () => {
  mocked.staff.mockResolvedValue({ profile: { role: "ADMIN" } });
  expect((await POST(request())).status).toBe(403);
  expect((await GET()).status).toBe(403);
  expect(mocked.orders).not.toHaveBeenCalled();
  expect(mocked.status).not.toHaveBeenCalled();
});
it("honors authentication and MFA failures before touching credentials", async () => {
  mocked.staff.mockRejectedValue(
    new AppError("MFA_REQUIRED", "Complete MFA.", 403),
  );
  expect((await POST(request())).status).toBe(403);
  expect(mocked.save).not.toHaveBeenCalled();
});
it("rejects foreign origins and attempts to change the seller client identity", async () => {
  expect((await POST(request({}, "https://foreign.example"))).status).toBe(403);
  expect(mocked.staff).not.toHaveBeenCalled();
  expect(
    (await POST(request({ clientSecret: secret, clientId: "other-seller" })))
      .status,
  ).toBe(400);
  expect(mocked.orders).not.toHaveBeenCalled();
});
it("does not replace the working credential when upstream authentication fails", async () => {
  mocked.orders.mockRejectedValue(
    new AppError("UPSTREAM_AUTH", "Eldorado rejected authentication.", 502),
  );
  expect((await POST(request())).status).toBe(502);
  expect(mocked.save).not.toHaveBeenCalled();
  expect(mocked.reset).not.toHaveBeenCalled();
});
it("limits authentication attempts and reports a failed save honestly", async () => {
  mocked.rate.mockResolvedValueOnce({ data: false });
  expect((await POST(request())).status).toBe(429);
  expect(mocked.orders).not.toHaveBeenCalled();
  mocked.save.mockResolvedValueOnce({
    error: { message: "synthetic DB failure" },
  });
  expect((await POST(request())).status).toBe(503);
  expect(mocked.reset).not.toHaveBeenCalled();
});

it("protects seller health reads with Owner, same-origin and rate checks", async () => {
  expect((await HEALTH(request({}))).status).toBe(200);
  expect(mocked.health).toHaveBeenCalledTimes(1);
  mocked.staff.mockResolvedValueOnce({ profile: { role: "SUPPORT_AGENT" } });
  expect((await HEALTH(request({}))).status).toBe(403);
  expect((await HEALTH(request({}, "https://foreign.example"))).status).toBe(
    403,
  );
  mocked.rate.mockResolvedValueOnce({ data: false });
  expect((await HEALTH(request({}))).status).toBe(429);
  expect(mocked.health).toHaveBeenCalledTimes(1);
});
