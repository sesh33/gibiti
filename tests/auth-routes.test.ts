import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const maybeSingle = vi.fn(),
    eq = vi.fn(() => ({ maybeSingle }));
  return {
    maybeSingle,
    eq,
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
    rpc: vi.fn(),
    auth: {
      signInWithPassword: vi.fn(),
      getUser: vi.fn(),
      signOut: vi.fn(),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => fixture,
}));
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
const req = (path: string, body: unknown = {}) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  fixture.auth.signInWithPassword.mockResolvedValue({
    data: { user: { id: "synthetic-user" } },
    error: null,
  });
  fixture.maybeSingle.mockResolvedValue({
    data: { role: "OWNER", active: true },
    error: null,
  });
  fixture.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: "aal1" },
    error: null,
  });
  fixture.rpc.mockResolvedValue({ data: true, error: null });
  fixture.auth.signOut.mockResolvedValue({ error: null });
  fixture.auth.getUser.mockResolvedValue({
    data: { user: { id: "synthetic-user" } },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("individual staff login", () => {
  it("routes a privileged aal1 login directly to MFA", async () => {
    const result = await login(
      req("/api/auth/login", {
        email: "staff@example.test",
        password: "synthetic-password",
      }),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, next: "/mfa" });
  });
  it("routes a verified privileged login to the inbox", async () => {
    fixture.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: null,
    });
    const result = await login(
      req("/api/auth/login", {
        email: "staff@example.test",
        password: "synthetic-password",
      }),
    );
    expect((await result.json()).next).toBe("/inbox");
  });
  it.each([null, { role: "VIEWER", active: false }])(
    "does not leave a signed-in session for missing/inactive membership",
    async (profile) => {
      fixture.maybeSingle.mockResolvedValue({ data: profile, error: null });
      const result = await login(
        req("/api/auth/login", {
          email: "staff@example.test",
          password: "synthetic-password",
        }),
      );
      expect(result.status).toBe(403);
      expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(fixture.rpc).not.toHaveBeenCalled();
    },
  );
  it("reports unavailable staff schema without leaking upstream error details", async () => {
    fixture.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "sensitive upstream fixture" },
    });
    const result = await login(
      req("/api/auth/login", {
        email: "staff@example.test",
        password: "synthetic-password",
      }),
    );
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain(
      "sensitive upstream fixture",
    );
  });
  it("rejects a revoked session after successful password verification", async () => {
    fixture.rpc.mockResolvedValue({ data: false, error: null });
    const result = await login(
      req("/api/auth/login", {
        email: "staff@example.test",
        password: "synthetic-password",
      }),
    );
    expect(result.status).toBe(403);
    expect(fixture.auth.signOut).toHaveBeenCalledOnce();
  });
});
describe("confirmed logout", () => {
  it("revokes the current JWT session before clearing auth cookies", async () => {
    const result = await logout(req("/api/auth/logout"));
    expect(result.status).toBe(200);
    expect(fixture.rpc).toHaveBeenCalledWith("revoke_own_employee_session");
    expect(fixture.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.auth.signOut.mock.invocationCallOrder[0],
    );
  });
  it("does not falsely report success when revocation fails", async () => {
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database error" },
    });
    const result = await logout(req("/api/auth/logout"));
    expect(result.status).toBe(503);
    expect(fixture.auth.signOut).not.toHaveBeenCalled();
  });
  it("is idempotent if an earlier successful logout response was lost", async () => {
    fixture.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const result = await logout(req("/api/auth/logout"));
    expect(result.status).toBe(200);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.auth.signOut).toHaveBeenCalledOnce();
  });
});
