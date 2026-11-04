export type OrderStateBucket =
  "pending" | "received" | "completed" | "canceled" | "other";

/** Only explicit labels enter operational/financial totals; new labels stay literal. */
export function orderStateBucket(state: string): OrderStateBucket {
  if (state === "Completed") return "completed";
  // Official lifecycle: Received confirms receipt; the fund-release period
  // begins afterwards. It is distinct from Completed and released revenue.
  // https://support.eldorado.gg/en/articles/8408993-receive-your-order
  // https://support.eldorado.gg/en/articles/8409006-tradeshield-protection-for-sellers
  if (state === "Received") return "received";
  if (state === "Canceled" || state === "Cancelled") return "canceled";
  if (state === "Paid" || state === "InProgress" || state === "Delivered")
    return "pending";
  return "other";
}

const knownOrderStates = [
  "Paid",
  "InProgress",
  "Delivered",
  "Completed",
  "Canceled",
  "Cancelled",
  "Disputed",
  "Received",
] as const;

/** Includes exact observed/selected labels without treating them as known states. */
export function orderStateOptions(
  observed: Iterable<string>,
  selected = "all",
) {
  const result = new Set<string>(knownOrderStates);
  for (const state of observed) if (state && state !== "all") result.add(state);
  if (selected && selected !== "all") result.add(selected);
  return [...result];
}
