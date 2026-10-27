/** PostgREST embeds unique FK relations as an object/null, collections as arrays. */
export function normalizeOrderDetail(record: Record<string, unknown>) {
  const list = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : value == null ? [] : [value];
  return {
    ...record,
    order_assignments: list(record.order_assignments),
    order_state_history: list(record.order_state_history),
    internal_notes: list(record.internal_notes),
  };
}
