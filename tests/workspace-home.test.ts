import { describe, expect, it } from "vitest";
import { workspaceHome } from "@/domains/authorization/workspace-home";
import { rolePermissions } from "@/domains/authorization/permissions";

describe("permission-aware operational home", () => {
  it.each([
    ["OWNER", "/offers"],
    ["ADMIN", "/offers"],
    ["SUPERVISOR", "/orders"],
    ["SUPPORT_AGENT", "/orders"],
    ["FULFILLMENT_AGENT", "/orders"],
    ["VIEWER", "/orders"],
  ] as const)(
    "opens the primary permitted workflow for %s",
    (role, destination) => {
      expect(workspaceHome(rolePermissions[role])).toBe(destination);
    },
  );

  it("prioritizes catalog availability for an operator with assigned-order access", () => {
    expect(
      workspaceHome(["offers.read", "offers.pause", "orders.read_assigned"]),
    ).toBe("/offers");
  });

  it("opens the catalog for a listing-only employee without routing them to orders", () => {
    expect(workspaceHome(["offers.read", "offers.pause"])).toBe("/offers");
    expect(workspaceHome(["offers.pause"])).toBe("/approvals");
  });

  it.each([
    ["inventory.read", "/inventory"],
    ["inventory.manage", "/inventory"],
    ["analytics.read", "/overview"],
    ["team.read", "/team"],
    ["audit.read", "/activity"],
    ["settings.manage", "/settings"],
  ])("opens the permitted module for %s", (permission, destination) => {
    expect(workspaceHome(new Set([permission]))).toBe(destination);
  });

  it("never chooses the unavailable inbox or an ungranted module", () => {
    expect(workspaceHome([])).toBe("/approvals");
    expect(workspaceHome(["conversations.read", "conversations.reply"])).toBe(
      "/approvals",
    );
    expect(workspaceHome(["orders.deliver"])).toBe("/approvals");
  });

  it("prefers an employee's order queue over secondary reporting and messaging", () => {
    expect(
      workspaceHome([
        "analytics.read",
        "conversations.read",
        "offers.read",
        "orders.read_assigned",
      ]),
    ).toBe("/orders");
  });
});
