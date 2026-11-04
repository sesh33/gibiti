import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  staff: vi.fn(),
  rate: vi.fn(),
  provision: vi.fn(),
  adapter: vi.fn(),
}));
vi.mock("@/domains/authentication/session", () => ({
  requireStaff: mocked.staff,
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/domains/authentication/staff-invitations", async (original) => ({
  ...(await original<
    typeof import("@/domains/authentication/staff-invitations")
  >()),
  provisionStaffInvitation: mocked.provision,
  staffInvitationDependencies: mocked.adapter,
}));
let POST: typeof import("@/app/api/team/route").POST;
const origin = "https://rivox.example";
const inviteUrl =
  origin + "/account/setup#token_hash=synthetic-private-link&type=invite";
function request(input: Record<string, unknown> = {}, requestOrigin = origin) {
  return new Request(origin + "/api/team", {
    method: "POST",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "employee@example.test",
      name: "Synthetic Employee",
      delivery: "link",
      ...input,
    }),
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", origin);
  mocked.rate.mockResolvedValue({ data: true, error: null });
  mocked.staff.mockResolvedValue({
    user: { id: "11111111-1111-4111-8111-111111111111" },
    profile: { role: "OWNER" },
    permissions: new Set(["team.invite"]),
    db: { rpc: mocked.rate },
  });
  mocked.adapter.mockReturnValue({ origin });
  mocked.provision.mockResolvedValue({ delivery: "link", inviteUrl });
  POST = (await import("@/app/api/team/route")).POST;
});
afterEach(() => vi.unstubAllEnvs());

describe("staff invitation HTTP boundary", () => {
  it("returns the private handoff once in a no-store response with least-privilege defaults", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      delivery: "link",
      inviteUrl,
    });
    expect(mocked.staff).toHaveBeenCalledWith("team.invite");
    expect(mocked.provision.mock.calls[0][1]).toEqual({
      email: "employee@example.test",
      name: "Synthetic Employee",
      role: "SUPPORT_AGENT",
      delivery: "link",
    });
    expect(mocked.rate).toHaveBeenCalledWith("consume_rate_limit", {
      bucket: "team.invite",
      max_hits: 10,
      window_seconds: 60,
    });
  });

  it("rejects a non-Owner even if that account holds a generic invitation permission", async () => {
    const actor = await mocked.staff();
    mocked.staff.mockResolvedValue({ ...actor, profile: { role: "ADMIN" } });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocked.provision).not.toHaveBeenCalled();
  });

  it("rejects cross-origin invitation creation before checking or modifying membership", async () => {
    const response = await POST(request({}, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(mocked.staff).not.toHaveBeenCalled();
    expect(mocked.provision).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("cannot invite another Owner or smuggle an unvalidated delivery target", async () => {
    for (const payload of [
      { role: "OWNER" },
      { redirectTo: "https://attacker.example" },
      { delivery: "unvalidated" },
    ]) {
      const response = await POST(request(payload));
      expect(response.status).toBe(400);
    }
    expect(mocked.provision).not.toHaveBeenCalled();
  });

  it("applies a server rate limit before creating Auth accounts or links", async () => {
    mocked.rate.mockResolvedValue({ data: false, error: null });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(mocked.provision).not.toHaveBeenCalled();
  });
});
