import { it, expect } from "vitest";
import { normalizeOrderDetail } from "@/domains/orders/shape";
it("normalizes the real unique assignment relation so an unassigned order can render", () => {
  expect(
    normalizeOrderDetail({
      id: "fixture",
      order_assignments: null,
      order_state_history: [],
      internal_notes: [],
    }),
  ).toEqual({
    id: "fixture",
    order_assignments: [],
    order_state_history: [],
    internal_notes: [],
  });
});
it("preserves an assigned employee object as a single relation and existing collections unchanged", () => {
  const assignment = { user_id: "fixture" };
  const notes = [{ body: "Fixture" }];
  expect(
    normalizeOrderDetail({
      order_assignments: assignment,
      internal_notes: notes,
    }).order_assignments,
  ).toEqual([assignment]);
  expect(normalizeOrderDetail({ internal_notes: notes }).internal_notes).toBe(
    notes,
  );
});
