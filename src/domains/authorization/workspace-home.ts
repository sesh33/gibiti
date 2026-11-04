/** Choose a useful landing page using verified permissions, never an unavailable integration. */
export function workspaceHome(granted: Iterable<string>) {
  const permissions = new Set(granted);
  if (permissions.has("offers.read") && permissions.has("offers.pause"))
    return "/offers";
  if (permissions.has("orders.read") || permissions.has("orders.read_assigned"))
    return "/orders";
  if (permissions.has("offers.read")) return "/offers";
  if (permissions.has("inventory.read") || permissions.has("inventory.manage"))
    return "/inventory";
  if (permissions.has("analytics.read")) return "/overview";
  if (permissions.has("team.read")) return "/team";
  if (permissions.has("audit.read")) return "/activity";
  if (permissions.has("settings.manage")) return "/settings";
  // Every active employee may review their own requests, including an account
  // whose custom permissions no longer include an operational module.
  return "/approvals";
}
