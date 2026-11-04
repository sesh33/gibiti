import { describe, expect, it } from "vitest";
import { catalogOperatorPreset } from "@/components/role-profiles";
import { effectivePermissions } from "@/domains/authorization/permissions";

describe("Catalog operator role preset", () => {
  it("grants only assigned orders and individual listing availability controls", () => {
    expect(catalogOperatorPreset.name).toBe("Catalog operator");
    expect(catalogOperatorPreset.baseRole).toBe("SUPPORT_AGENT");
    const allowed = effectivePermissions(catalogOperatorPreset.baseRole, [
      ...catalogOperatorPreset.overrides,
    ]);
    expect([...allowed].sort()).toEqual(
      ["orders.read_assigned", "offers.read", "offers.pause"].sort(),
    );
  });

  it("explicitly removes unavailable messaging permissions from the base role", () => {
    for (const permission of [
      "conversations.read",
      "conversations.reply",
      "conversations.internal_notes",
    ])
      expect(catalogOperatorPreset.overrides).toContainEqual({
        permission,
        allowed: false,
      });
  });
});
