import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  pollProgress,
  validWorkerAuthorization,
} from "@/domains/automation/worker";
import { orderPageSchema } from "@/domains/eldorado/client";
afterEach(() => vi.unstubAllEnvs());
it("requires the private worker key and rejects cookies or arbitrary bearer strings", () => {
  const key = "synthetic-worker-key-".repeat(3);
  expect(validWorkerAuthorization("Bearer " + key, key)).toBe(true);
  expect(validWorkerAuthorization("Bearer wrong", key)).toBe(false);
  expect(validWorkerAuthorization("Cookie: secret", key)).toBe(false);
  expect(validWorkerAuthorization(null, key)).toBe(false);
  expect(validWorkerAuthorization("Bearer short", "short")).toBe(false);
});
it("creates durable catchup work for bursts exceeding the newest page", () => {
  const base = {
    purchaseQuantity: 1,
    totalPrice: { amount: 1, currency: "USD" },
    state: { state: "Paid" },
    orderOfferDetails: { offerTitle: "Synthetic" },
  };
  const page = orderPageSchema.parse({
    results: [
      {
        ...base,
        id: "11111111-1111-4111-8111-111111111111",
        createdDate: "2026-11-13T01:00:00Z",
      },
      {
        ...base,
        id: "22222222-2222-4222-8222-222222222222",
        createdDate: "2026-11-13T00:59:00Z",
      },
    ],
    nextPageCursor: "next-fixture",
  });
  expect(pollProgress(page, "2026-11-13T00:00:00Z")).toEqual({
    newest: "2026-11-13T01:00:00.000Z",
    gapCursor: "next-fixture",
    gapStop: "2026-11-13T00:00:00Z",
  });
  expect(pollProgress(page, "2026-11-13T00:59:30Z").gapCursor).toBeNull();
});
const mocks = vi.hoisted(() => ({ run: vi.fn(), diagnostic: vi.fn() }));
vi.mock("@/domains/automation/worker", async (original) => ({
  ...(await original<typeof import("@/domains/automation/worker")>()),
  runHostedWorker: mocks.run,
  workerDiagnostic: mocks.diagnostic,
}));
import { POST } from "@/app/api/automation/worker/route";
const token = "synthetic-worker-token-".repeat(3);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", token);
  mocks.diagnostic.mockResolvedValue({ mode: "diagnostic", upstreamWrites: 0 });
  mocks.run.mockResolvedValue({ mode: "skipped" });
});
function request(body: unknown, authorization = "Bearer " + token) {
  return new Request("https://rivox.example/api/automation/worker", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
it("does not enter the runner before authentication or on an invalid body", async () => {
  expect((await POST(request({ mode: "run" }, "Bearer wrong"))).status).toBe(
    401,
  );
  expect((await POST(request({ mode: "run", price: 0.01 }))).status).toBe(400);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("defaults to a read-only diagnostic and never executes commercial work in that mode", async () => {
  const response = await POST(request({}));
  expect(response.status).toBe(200);
  expect((await response.json()).upstreamWrites).toBe(0);
  expect(mocks.diagnostic).toHaveBeenCalledOnce();
  expect(mocks.run).not.toHaveBeenCalled();
  await POST(request({ mode: "diagnostic" }));
  expect(mocks.run).not.toHaveBeenCalled();
});
it("only runs when the authenticated caller explicitly selects run mode", async () => {
  expect((await POST(request({ mode: "run" }))).status).toBe(200);
  expect(mocks.run).toHaveBeenCalledOnce();
});
