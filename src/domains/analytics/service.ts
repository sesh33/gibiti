import { orderStateBucket } from "@/domains/orders/states";

export function calculateMetrics(
  orders: {
    amount: number;
    currency: string;
    state: string;
    purchased_at: string;
  }[],
) {
  const byCurrency: Record<string, number> = {};
  const stateCounts = new Map<string, number>();
  let completed = 0,
    pending = 0,
    received = 0,
    canceled = 0,
    other = 0;
  for (const order of orders) {
    stateCounts.set(order.state, (stateCounts.get(order.state) ?? 0) + 1);
    const bucket = orderStateBucket(order.state);
    if (bucket === "completed") {
      completed++;
      byCurrency[order.currency] =
        (byCurrency[order.currency] ?? 0) + Number(order.amount);
    } else if (bucket === "canceled") canceled++;
    else if (bucket === "pending") pending++;
    else if (bucket === "received") received++;
    else other++;
  }
  return {
    orders: orders.length,
    completed,
    pending,
    received,
    canceled,
    other,
    stateBreakdown: [...stateCounts]
      .map(([state, count]) => ({
        state,
        count,
        bucket: orderStateBucket(state),
      }))
      .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state)),
    completedVolume: byCurrency,
    scope:
      "Visible synchronized records only; not an account-wide sales report. Known open states are Paid, InProgress and Delivered. Received confirms delivery, does not prove funds are released, and is excluded from Completed volume. Other labels remain unclassified and are never assumed pending or completed. Completed volume includes only the exact Completed state.",
  };
}
