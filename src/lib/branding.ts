/** Public, deployment-specific branding. Never add private settings here. */
const name =
  process.env.NEXT_PUBLIC_WORKSPACE_NAME?.trim().slice(0, 32) || "RIVOX";
const organization =
  process.env.NEXT_PUBLIC_WORKSPACE_ORGANIZATION?.trim().slice(0, 64) ||
  "Rivox workspace";
const colors: Record<string, string> = {
  blue: "#5378ff",
  violet: "#8b6cff",
  emerald: "#27c99a",
  amber: "#e8a839",
};
export const workspaceBrand = {
  name,
  organization,
  initial: name.slice(0, 1).toUpperCase(),
  accent:
    colors[process.env.NEXT_PUBLIC_WORKSPACE_ACCENT ?? "blue"] ?? colors.blue,
};
