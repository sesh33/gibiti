export function calculateMetrics(
  orders: {
    amount: number;
    currency: string;
    state: string;
    purchased_at: string;
  }[],
) {
  const byCurrency: Record<string, number> = {};
  let completed = 0,
    pending = 0,
    canceled = 0;
  for (const order of orders) {
    if (order.state === "Completed") {
      completed++;
      byCurrency[order.currency] =
        (byCurrency[order.currency] ?? 0) + Number(order.amount);
    } else if (order.state === "Canceled" || order.state === "Cancelled")
      canceled++;
    else pending++;
  }
  return {
    orders: orders.length,
    completed,
    pending,
    canceled,
    completedVolume: byCurrency,
    scope: "Synchronized records only; not an account-wide sales report.",
  };
}
