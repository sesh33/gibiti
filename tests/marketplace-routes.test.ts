import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({
  staff: vi.fn(),
  load: vi.fn(),
  execute: vi.fn(),
  dependencies: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/domains/authentication/session", () => ({
  requireStaff: mocked.staff,
}));
vi.mock("@/domains/eldorado/operations", () => ({
  loadMarketTicket: mocked.load,
  executeMarketTicket: mocked.execute,
  operationDependencies: mocked.dependencies,
}));
import { POST } from "@/app/api/marketplace/requests/[id]/route";
const id = "11111111-1111-4111-8111-111111111111",
  origin = "https://rivox.example";
const context = { params: Promise.resolve({ id }) };
const request = (
  body: unknown = { mode: "execute", confirm: true },
  from = origin,
) =>
  new Request(origin + "/api/marketplace/requests/" + id, {
    method: "POST",
    headers: { Origin: from, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
  mocked.staff.mockResolvedValue({
    user: { id: "requester" },
    permissions: new Set(["offers.update_price"]),
    db: { rpc: mocked.rate },
  });
  mocked.load.mockResolvedValue({
    id,
    requester_id: "requester",
    approver_id: "reviewer",
    payload: {
      marketV1: true,
      change: { kind: "offer.price", body: { amount: 2, currency: "USD" } },
    },
  });
  mocked.rate.mockResolvedValue({ data: true });
  mocked.execute.mockResolvedValue({
    operation: { status: "succeeded" },
    message: "Verified",
  });
  mocked.dependencies.mockReturnValue({});
});
afterEach(() => vi.unstubAllEnvs());
it("rejects foreign origins, missing confirmation and unauthorized executors", async () => {
  expect(
    (await POST(request({}, "https://foreign.example"), context)).status,
  ).toBe(403);
  expect(mocked.load).not.toHaveBeenCalled();
  expect((await POST(request({ mode: "execute" }), context)).status).toBe(400);
  const actor = await mocked.staff();
  mocked.staff.mockResolvedValue({
    ...actor,
    user: { id: "unrelated-reviewer" },
  });
  expect((await POST(request(), context)).status).toBe(403);
  expect(mocked.execute).not.toHaveBeenCalled();
});
it("rechecks operation permissions and the full-detail privilege combination", async () => {
  const actor = await mocked.staff();
  mocked.staff.mockResolvedValue({
    ...actor,
    permissions: new Set(["offers.read"]),
  });
  expect((await POST(request(), context)).status).toBe(403);
  mocked.staff.mockResolvedValue({
    ...actor,
    permissions: new Set(["offers.create", "offers.update_stock"]),
  });
  const ticket = await mocked.load();
  mocked.load.mockResolvedValue({
    ...ticket,
    payload: { ...ticket.payload, change: { kind: "offer.details" } },
  });
  expect((await POST(request(), context)).status).toBe(403);
  expect(mocked.execute).not.toHaveBeenCalled();
});
it("checks recorded outcomes in read-only mode and preserves no-store", async () => {
  const response = await POST(
    request({ mode: "check", confirm: true }),
    context,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocked.execute.mock.calls[0][2]).toBe(true);
});
it("honors application rate limits before any external execution", async () => {
  mocked.rate.mockResolvedValue({ data: false });
  const response = await POST(request(), context);
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(mocked.execute).not.toHaveBeenCalled();
});
