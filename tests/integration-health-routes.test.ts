import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  configured: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/domains/authentication/session", () => ({
  requireStaff: mocks.staff,
}));
vi.mock("@/domains/eldorado/client", () => ({
  eldoradoConfigured: mocks.configured,
}));
vi.mock("@/domains/eldorado/credentials", () => ({
  sellerConnectionStatus: mocks.connection,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({ rpc: mocks.adminRpc }),
}));
import { GET as WORKSPACE } from "@/app/api/workspace/[resource]/route";
import { GET as AUTOMATION } from "@/app/api/automation/settings/route";

const results = new Map<string, { data: unknown; error: unknown }>();
function query(table: string) {
  const result = results.get(table) ?? { data: [], error: null };
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(result),
    then: (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}
function workspace() {
  return WORKSPACE(
    new Request("https://rivox.example/api/workspace/settings"),
    { params: Promise.resolve({ resource: "settings" }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  results.clear();
  vi.stubEnv("APP_ORIGIN", "https://rivox.example");
  mocks.from.mockImplementation(query);
  mocks.staff.mockResolvedValue({
    profile: { role: "OWNER" },
    permissions: new Set(["settings.manage"]),
    db: { from: mocks.from, rpc: mocks.rpc },
  });
  mocks.configured.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.connection.mockResolvedValue({
    configured: true,
    verifiedAt: "2026-11-15T10:00:00Z",
    verifiedOrigin: "https://rivox.example",
  });
  results.set("workspace_preferences", {
    data: {
      poll_enabled: false,
      poll_seconds: 60,
      auto_delivery_enabled: false,
      auto_pricing_enabled: false,
    },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["integration_errors", "integration_sync_state"])(
  "returns unavailable when %s cannot be read instead of declaring the database healthy",
  async (table) => {
    results.set(table, {
      data: null,
      error: { message: "private database diagnostics" },
    });
    const response = await workspace();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("INTEGRATION_HEALTH_UNAVAILABLE");
    expect(text).not.toContain("private database diagnostics");
    expect(text).not.toContain('"database":true');
    expect(mocks.staff).toHaveBeenCalledWith("settings.manage");
  },
);
it("requires the latest per-source error query and preserves the private pagination token", async () => {
  results.set("integration_sync_state", {
    data: [
      {
        provider: "eldorado",
        last_success_at: "2026-11-15T10:00:00Z",
        cursor: "private-cursor",
      },
    ],
    error: null,
  });
  mocks.rpc.mockResolvedValueOnce({
    data: [
      {
        provider: "eldorado",
        code: "ELDORADO_ACCESS_DENIED",
        created_at: "2026-11-15T11:00:00Z",
      },
    ],
    error: null,
  });
  const response = await workspace(),
    body = await response.json();
  expect(body.integration.sources[0]).toMatchObject({
    hasNextPage: true,
    state: "attention",
    issue: { code: "ELDORADO_ACCESS_DENIED" },
  });
  expect(JSON.stringify(body)).not.toContain("private-cursor");
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "private-rpc-failure" },
  });
  expect((await workspace()).status).toBe(503);
});
it("distinguishes an unavailable runtime from restricted diagnostics without losing preferences", async () => {
  mocks.adminRpc.mockResolvedValueOnce({
    data: null,
    error: { message: "private-runtime-error" },
  });
  const failure = await AUTOMATION(),
    body = await failure.json();
  expect(body).toMatchObject({
    runtime: null,
    runtimeAccess: "unavailable",
    scheduler: { status: "unavailable" },
    settings: { pollEnabled: false },
  });
  expect(JSON.stringify(body)).not.toContain("private-runtime-error");
  mocks.staff.mockResolvedValueOnce({
    permissions: new Set(["orders.read"]),
    db: { from: mocks.from },
  });
  const restricted = await AUTOMATION();
  expect(await restricted.json()).toMatchObject({
    runtime: null,
    runtimeAccess: "restricted",
    scheduler: { status: "restricted" },
  });
  expect(mocks.adminRpc).toHaveBeenCalledTimes(1);
});
