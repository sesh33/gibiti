import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  ownerQuery: vi.fn(),
  invite: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  bootstrap: vi.fn(),
  registerSession: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: dependencies.ownerQuery }) }),
    }),
    auth: { admin: { inviteUserByEmail: dependencies.invite } },
    rpc: dependencies.bootstrap,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      verifyOtp: dependencies.verifyOtp,
      setSession: dependencies.setSession,
      getUser: dependencies.getUser,
      updateUser: dependencies.updateUser,
      signOut: dependencies.signOut,
    },
    rpc: dependencies.registerSession,
  }),
}));

const token = "a".repeat(43);
const email = "intended-owner@example.test";
let POST: typeof import("@/app/api/setup/owner/route").POST;
let EMAIL_POST: typeof import("@/app/api/setup/owner/email-session/route").POST;
function request(
  input: Record<string, unknown>,
  origin = "https://rivox-test.example",
) {
  return new Request("https://rivox-test.example/api/setup/owner", {
    method: "POST",
    headers: {
      Origin: origin,
      Host: "rivox-test.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, email, ...input }),
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("RIVOX_BOOTSTRAP_ENABLED", "true");
  vi.stubEnv("RIVOX_HOSTED_OWNER_SETUP", "true");
  vi.stubEnv("RIVOX_BOOTSTRAP_TOKEN", token);
  vi.stubEnv("RIVOX_BOOTSTRAP_EXPIRES_AT", String(Date.now() + 30 * 60 * 1000));
  vi.stubEnv("APP_ORIGIN", "https://rivox-test.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  dependencies.ownerQuery.mockResolvedValue({ data: [], error: null });
  dependencies.invite.mockResolvedValue({ data: {}, error: null });
  dependencies.signOut.mockResolvedValue({ error: null });
  dependencies.bootstrap.mockResolvedValue({ error: null });
  dependencies.registerSession.mockResolvedValue({ data: true, error: null });
  dependencies.updateUser.mockResolvedValue({ error: null });
  dependencies.setSession.mockResolvedValue({ error: null });
  POST = (await import("@/app/api/setup/owner/route")).POST;
  EMAIL_POST = (await import("@/app/api/setup/owner/email-session/route")).POST;
});
afterEach(() => vi.unstubAllEnvs());

describe("hosted Owner setup request boundary", () => {
  it("sends no verification email without the valid capability and exact same origin", async () => {
    const unauthorized = await POST(
      request({ action: "invite", confirm: true, token: "wrong token" }),
    );
    expect(unauthorized.status).toBe(401);
    const crossOrigin = await POST(
      request({ action: "invite", confirm: true }, "https://attacker.example"),
    );
    expect(crossOrigin.status).toBe(403);
    expect(dependencies.invite).not.toHaveBeenCalled();
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });

  it("requests a verification email only after explicit confirmation and creates no membership", async () => {
    const response = await POST(request({ action: "invite", confirm: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, next: "verify-email" });
    expect(dependencies.invite).toHaveBeenCalledWith(email, {
      redirectTo: "https://rivox-test.example/setup/owner",
    });
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports unavailable mail delivery without claiming an email was sent", async () => {
    dependencies.invite.mockResolvedValue({
      error: new Error("synthetic provider failure"),
    });
    const response = await POST(request({ action: "invite", confirm: true }));
    expect(response.status).toBe(502);
    const result = await response.json();
    expect(result.error.code).toBe("OWNER_EMAIL_DELIVERY_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("synthetic provider failure");
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });

  it("requires verified email identity from the OTP provider, not merely a successful HTTP response", async () => {
    dependencies.verifyOtp.mockResolvedValue({
      data: { user: { email } },
      error: null,
    });
    const response = await POST(request({ action: "verify", code: "123456" }));
    expect(response.status).toBe(401);
    expect(dependencies.signOut).toHaveBeenCalledOnce();
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });

  it("allows password selection after email proof while still creating no staff membership", async () => {
    dependencies.verifyOtp.mockResolvedValue({
      data: { user: { email, email_confirmed_at: "2026-11-02T00:00:00Z" } },
      error: null,
    });
    const response = await POST(request({ action: "verify", code: "123456" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: "choose-password",
    });
    expect(dependencies.verifyOtp).toHaveBeenCalledWith({
      email,
      token: "123456",
      type: "invite",
    });
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(dependencies.updateUser).not.toHaveBeenCalled();
  });

  it("checks the verified session again before setting a password or creating the Owner", async () => {
    dependencies.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const response = await POST(
      request({
        action: "complete",
        accountMode: "verified-hosted",
        confirm: true,
        name: "Intended Owner",
        password: "synthetic long password",
      }),
    );
    expect(response.status).toBe(401);
    expect(dependencies.updateUser).not.toHaveBeenCalled();
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });

  it("blocks invitation and completion once an Owner exists", async () => {
    dependencies.ownerQuery.mockResolvedValue({
      data: [{ id: "existing-owner" }],
      error: null,
    });
    const response = await POST(request({ action: "invite", confirm: true }));
    expect(response.status).toBe(409);
    expect(dependencies.invite).not.toHaveBeenCalled();
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });

  it("continues the private tab only when its chosen email matches the verified browser session", async () => {
    dependencies.getUser.mockResolvedValue({
      data: { user: { email, email_confirmed_at: "2026-11-02T00:00:00Z" } },
      error: null,
    });
    const response = await POST(request({ action: "check-email" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: "choose-password",
    });
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(dependencies.updateUser).not.toHaveBeenCalled();

    const mismatch = await POST(
      request({ action: "check-email", email: "someone-else@example.test" }),
    );
    expect(mismatch.status).toBe(401);
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });
});

describe("default Supabase Owner email-link session bridge", () => {
  const sessionInput = {
    accessToken: "a".repeat(160),
    refreshToken: "b".repeat(40),
  };

  it("converts only an explicitly submitted valid confirmed session and creates no membership", async () => {
    dependencies.getUser.mockResolvedValue({
      data: { user: { email, email_confirmed_at: "2026-11-02T00:00:00Z" } },
      error: null,
    });
    const response = await EMAIL_POST(request(sessionInput));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: "return-to-private-setup",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.setSession).toHaveBeenCalledWith({
      access_token: sessionInput.accessToken,
      refresh_token: sessionInput.refreshToken,
    });
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(dependencies.registerSession).not.toHaveBeenCalled();
    expect(dependencies.invite).not.toHaveBeenCalled();
  });

  it("blocks cross-origin and expired setup attempts before accepting credentials", async () => {
    const response = await EMAIL_POST(
      request(sessionInput, "https://attacker.example"),
    );
    expect(response.status).toBe(403);
    vi.stubEnv("RIVOX_BOOTSTRAP_EXPIRES_AT", String(Date.now() - 1000));
    const expired = await EMAIL_POST(request(sessionInput));
    expect(expired.status).toBe(403);
    expect(dependencies.setSession).not.toHaveBeenCalled();
  });

  it("stops after first Owner creation before establishing any email session", async () => {
    dependencies.ownerQuery.mockResolvedValue({
      data: [{ id: "existing-owner" }],
      error: null,
    });
    const response = await EMAIL_POST(request(sessionInput));
    expect(response.status).toBe(409);
    expect(dependencies.setSession).not.toHaveBeenCalled();
  });

  it("rejects a mismatched actual host and clears an Auth-rejected session", async () => {
    const badHost = request(sessionInput);
    badHost.headers.set("host", "attacker.example");
    expect((await EMAIL_POST(badHost)).status).toBe(403);
    expect(dependencies.setSession).not.toHaveBeenCalled();
    dependencies.setSession.mockResolvedValue({
      error: new Error("synthetic expired session"),
    });
    const response = await EMAIL_POST(request(sessionInput));
    expect(response.status).toBe(401);
    expect(dependencies.getUser).not.toHaveBeenCalled();
    expect(dependencies.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { email } }, error: null },
    {
      data: { user: { email, email_confirmed_at: "2026-11-02T00:00:00Z" } },
      error: new Error("synthetic identity failure"),
    },
  ])(
    "clears credentials when the configured Auth provider cannot verify a confirmed email: %j",
    async (identity) => {
      dependencies.getUser.mockResolvedValue(identity);
      const response = await EMAIL_POST(request(sessionInput));
      expect(response.status).toBe(401);
      expect(dependencies.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(dependencies.bootstrap).not.toHaveBeenCalled();
      expect(dependencies.registerSession).not.toHaveBeenCalled();
    },
  );
});
