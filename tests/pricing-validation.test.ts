import { expect, it, vi } from "vitest";
import { pricingValidation } from "@/domains/eldorado/pricing-validation";
import { pricingFreshnessGuard } from "@/domains/pricing/quotes";

const operationId = "11111111-1111-4111-8111-111111111111",
  quoteId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  let clock = Date.parse("2026-11-15T12:00:00Z");
  const proof = {
      executable: true,
      collectionStartedAt: new Date(clock).toISOString(),
      observedAt: new Date(clock + 1000).toISOString(),
      validUntil: new Date(clock + 60000).toISOString(),
    },
    assertFresh = pricingFreshnessGuard(
      proof,
      new Date(clock + 120000).toISOString(),
      () => clock,
    ),
    rpc = vi.fn().mockResolvedValue({ error: null }),
    validate = vi.fn().mockResolvedValue({ assertFresh, proof });
  const guard = pricingValidation(
    operationId,
    quoteId,
    { rpc } as unknown as NonNullable<Parameters<typeof pricingValidation>[2]>,
    validate,
  );
  return {
    guard,
    proof,
    rpc,
    validate,
    advance: (seconds: number) => {
      clock += seconds * 1000;
    },
  };
}

it("requires an audited market recheck before the final write guard can pass", async () => {
  const f = fixture();
  expect(() => f.guard.beforeSend()).toThrow(
    expect.objectContaining({ code: "ELDORADO_WRITE_NOT_SENT" }),
  );
  await f.guard.verify();
  expect(f.validate).toHaveBeenCalledWith(quoteId);
  expect(f.rpc).toHaveBeenCalledWith("record_repricing_validation", {
    operation_id: operationId,
    quote_id: quoteId,
    evidence: f.proof,
  });
  expect(() => f.guard.beforeSend()).not.toThrow();
});

it("classifies expiry across claim or OAuth latency as definitively not sent", async () => {
  const f = fixture();
  await f.guard.verify();
  f.advance(61);
  expect(() => f.guard.beforeSend()).toThrow(
    expect.objectContaining({ code: "ELDORADO_WRITE_NOT_SENT" }),
  );
  expect(f.rpc).toHaveBeenCalledTimes(1);
  expect(f.validate).toHaveBeenCalledTimes(1);
});

it("does not authorize a write when fresh evidence could not be audited", async () => {
  const f = fixture();
  f.rpc.mockResolvedValue({ error: { code: "XX000" } });
  await expect(f.guard.verify()).rejects.toMatchObject({
    code: "QUOTE_AUDIT_FAILED",
  });
  expect(() => f.guard.beforeSend()).toThrow(
    expect.objectContaining({ code: "ELDORADO_WRITE_NOT_SENT" }),
  );
});

it("checks freshness after the audit RPC rather than carrying an expired authorization forward", async () => {
  const f = fixture();
  f.rpc.mockImplementation(async () => {
    f.advance(61);
    return { error: null };
  });
  await expect(f.guard.verify()).rejects.toMatchObject({
    code: "COMPARISON_STALE",
  });
  expect(() => f.guard.beforeSend()).toThrow(
    expect.objectContaining({ code: "ELDORADO_WRITE_NOT_SENT" }),
  );
});

it("does not require a quote for ordinary independently reviewed operations", async () => {
  const rpc = vi.fn(),
    validate = vi.fn(),
    guard = pricingValidation(
      operationId,
      null,
      { rpc } as unknown as NonNullable<
        Parameters<typeof pricingValidation>[2]
      >,
      validate,
    );
  await guard.verify();
  expect(() => guard.beforeSend()).not.toThrow();
  expect(rpc).not.toHaveBeenCalled();
  expect(validate).not.toHaveBeenCalled();
});
