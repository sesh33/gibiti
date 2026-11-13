import { expect, it, vi } from "vitest";
import {
  executeMarketTicket,
  type MarketTicket,
  type OperationDependencies,
} from "@/domains/eldorado/operations";
import { AppError } from "@/lib/errors";
const id = "11111111-1111-4111-8111-111111111111";
const before = { id, state: "Active", price: 1, currency: "USD", quantity: 10 };
function fixture() {
  let ticket: MarketTicket = {
    id,
    requester_id: "requester",
    approver_id: "reviewer",
    action: "offers.update_price",
    target_id: "predefined:" + id,
    status: "approved",
    external_attempted: false,
    payload: {
      marketV1: true,
      nativeId: id,
      change: { kind: "offer.price", body: { amount: 2, currency: "USD" } },
      before,
    },
  };
  const current = vi.fn().mockResolvedValue(before),
    claim = vi.fn(async () => {
      ticket = { ...ticket, status: "executing", external_attempted: true };
      return ticket;
    }),
    write = vi.fn().mockResolvedValue({ acknowledged: true }),
    finish = vi.fn(
      async (status: string, proof: Record<string, unknown> | null) => {
        ticket = { ...ticket, status, result: proof };
        return ticket;
      },
    );
  const dependencies: OperationDependencies = { current, claim, write, finish };
  return {
    get ticket() {
      return ticket;
    },
    set ticket(value: MarketTicket) {
      ticket = value;
    },
    dependencies,
    current,
    claim,
    write,
    finish,
  };
}
it("rejects unapproved execution and stale data without issuing a write", async () => {
  const f = fixture();
  f.ticket = { ...f.ticket, status: "pending" };
  await expect(
    executeMarketTicket(f.ticket, f.dependencies),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(f.write).not.toHaveBeenCalled();
  f.ticket = { ...f.ticket, status: "approved" };
  f.current.mockResolvedValue({ ...before, price: 1.1 });
  const result = await executeMarketTicket(f.ticket, f.dependencies);
  expect(result.operation.status).toBe("failed");
  expect(f.claim).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});
it("claims once and records the actual observed new price", async () => {
  const f = fixture();
  f.current
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce({ ...before, price: 2 });
  const result = await executeMarketTicket(f.ticket, f.dependencies);
  expect(result.operation.status).toBe("succeeded");
  expect(f.claim).toHaveBeenCalledOnce();
  expect(f.write).toHaveBeenCalledOnce();
  await executeMarketTicket(result.operation, f.dependencies);
  expect(f.write).toHaveBeenCalledOnce();
});
it("blocks ambiguous writes and reconciles by reading without another send", async () => {
  const f = fixture();
  f.write.mockRejectedValue(
    new AppError("ELDORADO_WRITE_UNKNOWN", "Uncertain", 502),
  );
  const result = await executeMarketTicket(f.ticket, f.dependencies);
  expect(result.operation.status).toBe("blocked");
  f.current.mockResolvedValue({ ...before, price: 2 });
  const checked = await executeMarketTicket(
    result.operation,
    f.dependencies,
    true,
  );
  expect(checked.operation.status).toBe("succeeded");
  expect(f.write).toHaveBeenCalledOnce();
});
it("keeps an undesired observed result locked and records definite rejection", async () => {
  const f = fixture();
  f.write.mockRejectedValueOnce(
    new AppError("ELDORADO_WRITE_UNKNOWN", "Uncertain", 502),
  );
  let result = await executeMarketTicket(f.ticket, f.dependencies);
  result = await executeMarketTicket(result.operation, f.dependencies, true);
  expect(result.operation.status).toBe("blocked");
  expect(f.write).toHaveBeenCalledOnce();
  const g = fixture();
  g.write.mockRejectedValue(
    new AppError("ELDORADO_WRITE_REJECTED", "Rejected", 502),
  );
  expect(
    (await executeMarketTicket(g.ticket, g.dependencies)).operation.status,
  ).toBe("rejected");
});
it("never resends after a postflight read or result persistence failure", async () => {
  const f = fixture();
  f.current
    .mockResolvedValueOnce(before)
    .mockRejectedValueOnce(new Error("offline"));
  const result = await executeMarketTicket(f.ticket, f.dependencies);
  expect(result.operation.status).toBe("blocked");
  expect(result.operation.result?.acknowledged).toBe(true);
  const g = fixture();
  g.current
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce({ ...before, price: 2 });
  g.finish.mockRejectedValueOnce(new Error("DB unavailable"));
  await expect(executeMarketTicket(g.ticket, g.dependencies)).rejects.toThrow(
    "DB unavailable",
  );
  expect(g.write).toHaveBeenCalledOnce();
});
it("does not turn checking a pending request into execution", async () => {
  const f = fixture();
  f.ticket = { ...f.ticket, status: "pending" };
  await executeMarketTicket(f.ticket, f.dependencies, true);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.claim).not.toHaveBeenCalled();
});
