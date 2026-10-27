export const permissions = [
  "orders.read",
  "orders.read_assigned",
  "orders.deliver",
  "orders.cancel",
  "orders.update_delivery",
  "offers.read",
  "offers.create",
  "offers.update_price",
  "offers.update_stock",
  "offers.pause",
  "offers.delete",
  "conversations.read",
  "conversations.reply",
  "conversations.assign",
  "conversations.read_all",
  "conversations.internal_notes",
  "inventory.read",
  "inventory.manage",
  "inventory.secrets.read",
  "team.read",
  "team.invite",
  "team.manage_permissions",
  "analytics.read",
  "audit.read",
  "settings.manage",
  "approvals.review_access",
] as const;
export type Permission = (typeof permissions)[number];
export const roles = [
  "OWNER",
  "ADMIN",
  "SUPERVISOR",
  "SUPPORT_AGENT",
  "FULFILLMENT_AGENT",
  "VIEWER",
] as const;
export type Role = (typeof roles)[number];
export const rolePermissions: Record<Role, readonly Permission[]> = {
  OWNER: permissions,
  ADMIN: permissions.filter(
    (p) =>
      p !== "settings.manage" &&
      p !== "team.manage_permissions" &&
      p !== "inventory.secrets.read",
  ),
  SUPERVISOR: [
    "orders.read",
    "orders.deliver",
    "orders.cancel",
    "orders.update_delivery",
    "conversations.read",
    "conversations.reply",
    "conversations.assign",
    "conversations.read_all",
    "conversations.internal_notes",
    "team.read",
    "analytics.read",
  ],
  SUPPORT_AGENT: [
    "orders.read_assigned",
    "conversations.read",
    "conversations.reply",
    "conversations.internal_notes",
  ],
  FULFILLMENT_AGENT: [
    "orders.read_assigned",
    "orders.deliver",
    "orders.update_delivery",
    "inventory.read",
  ],
  VIEWER: [
    "orders.read",
    "offers.read",
    "inventory.read",
    "conversations.read",
  ],
};
export function effectivePermissions(
  role: Role,
  overrides: { permission: string; allowed: boolean }[] = [],
): Set<Permission> {
  const result = new Set<Permission>(rolePermissions[role]);
  for (const override of overrides)
    if (permissions.includes(override.permission as Permission)) {
      if (override.allowed) result.add(override.permission as Permission);
      else result.delete(override.permission as Permission);
    }
  return result;
}
export function mayReadOrder(
  perms: Set<Permission>,
  userId: string,
  assignedTo: string | null,
) {
  return (
    perms.has("orders.read") ||
    (perms.has("orders.read_assigned") && assignedTo === userId)
  );
}
