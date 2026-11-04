import { describe, expect, it } from "vitest";
import { calculateMetrics } from "@/domains/analytics/service";
import { orderStateOptions } from "@/domains/orders/states";

const order = (state: string, amount = 100, currency = "USD") => ({
  state,
  amount,
  currency,
  purchased_at: "2026-11-02T12:00:00Z",
});

describe("literal upstream order states", () => {
  it("keeps eight Received orders as delivery-confirmed, not pending work or completed sales", () => {
    const metrics = calculateMetrics(
      Array.from({ length: 8 }, () => order("Received")),
    );
    expect(metrics).toMatchObject({
      orders: 8,
      pending: 0,
      received: 8,
      completed: 0,
      canceled: 0,
      other: 0,
      completedVolume: {},
      stateBreakdown: [{ state: "Received", count: 8, bucket: "received" }],
    });
    expect(metrics.completedVolume).toEqual({});
  });

  it("classifies explicit states only and keeps financial currencies separate", () => {
    const metrics = calculateMetrics([
      order("Paid"),
      order("InProgress"),
      order("Delivered"),
      order("Completed", 10),
      order("Completed", 20, "EUR"),
      order("Canceled"),
      order("Cancelled"),
      order("Received", 9000),
      order("FutureReviewState", 8000, "EUR"),
      order("completed", 7000),
    ]);
    expect(metrics).toMatchObject({
      orders: 10,
      pending: 3,
      received: 1,
      completed: 2,
      canceled: 2,
      other: 2,
      completedVolume: { USD: 10, EUR: 20 },
    });
    expect(
      metrics.pending +
        metrics.received +
        metrics.completed +
        metrics.canceled +
        metrics.other,
    ).toBe(metrics.orders);
    expect(
      metrics.stateBreakdown.reduce((sum, state) => sum + state.count, 0),
    ).toBe(metrics.orders);
    expect(metrics.stateBreakdown).toContainEqual({
      state: "FutureReviewState",
      count: 1,
      bucket: "other",
    });
  });

  it("preserves unusual future labels safely in the literal breakdown", () => {
    const metrics = calculateMetrics([order("__proto__"), order("__proto__")]);
    expect(metrics.other).toBe(2);
    expect(metrics.stateBreakdown).toEqual([
      { state: "__proto__", count: 2, bucket: "other" },
    ]);
  });

  it("offers exact Received, observed and selected labels in order filters", () => {
    const states = orderStateOptions(
      ["New State / review", "Received", "Received"],
      "OlderUnclassifiedState",
    );
    expect(states).toContain("Received");
    expect(states).toContain("New State / review");
    expect(states).toContain("OlderUnclassifiedState");
    expect(states.filter((state) => state === "Received")).toHaveLength(1);
    expect(states).not.toContain("all");
  });
});
