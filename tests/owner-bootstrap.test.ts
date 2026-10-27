import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOwnerSetupAccess,
  completeOwnerBootstrap,
  localOwnerSetupEnabled,
  localSupabaseAccountCreationAllowed,
  temporaryHttpsOwnerSetupEnabled,
  type OwnerBootstrapDependencies,
} from "@/domains/authentication/owner-bootstrap";

const now = 1_800_000_000_000;
const configuration = {
  enabled: "true",
  token: "a".repeat(43),
  origin: "http://127.0.0.1:3000",
  expiresAt: String(now + 30 * 60 * 1000),
};
const request = () =>
  new Request("http://127.0.0.1:3000/api/setup/owner", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:3000" },
  });
const input = {
  email: "owner@example.test",
  password: "synthetic account password",
  name: "Intended Owner",
};
function dependencies() {
  return {
    ownerExists: vi.fn().mockResolvedValue(false),
    signIn: vi.fn().mockResolvedValue({
      id: "intended-user",
      email: "owner@example.test",
      emailVerified: true,
    }),
    bootstrap: vi.fn().mockResolvedValue(undefined),
    registerSession: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  } satisfies OwnerBootstrapDependencies;
}
afterEach(() => vi.unstubAllEnvs());

describe("private Owner setup boundary", () => {
  it("is disabled by default and rejects hosted origins even when explicitly enabled", () => {
    expect(localOwnerSetupEnabled({}, now)).toBe(false);
    expect(
      localOwnerSetupEnabled(
        { ...configuration, origin: "https://rivox.example" },
        now,
      ),
    ).toBe(false);
    expect(localOwnerSetupEnabled(configuration, now)).toBe(true);
  });
  it("rejects expired, unbounded, and malformed setup credentials", () => {
    for (const overrides of [
      { expiresAt: String(now - 1) },
      { expiresAt: String(now + 2 * 60 * 60 * 1000) },
      { token: "short" },
      { expiresAt: "not a timestamp" },
    ])
      expect(
        localOwnerSetupEnabled({ ...configuration, ...overrides }, now),
      ).toBe(false);
  });
  it("requires matching request origin, URL origin, and the private token", () => {
    expect(() =>
      assertOwnerSetupAccess(
        request(),
        configuration.token,
        configuration,
        now,
      ),
    ).not.toThrow();
    expect(() =>
      assertOwnerSetupAccess(request(), "wrong token", configuration, now),
    ).toThrow("token was not accepted");
    expect(() =>
      assertOwnerSetupAccess(
        new Request("http://127.0.0.1:3000/api/setup/owner", {
          headers: { origin: "https://attacker.example" },
        }),
        configuration.token,
        configuration,
        now,
      ),
    ).toThrow("configured origin");
    expect(() =>
      assertOwnerSetupAccess(
        new Request("https://rivox.example/api/setup/owner", {
          headers: { origin: configuration.origin },
        }),
        configuration.token,
        configuration,
        now,
      ),
    ).toThrow("configured origin");
  });
  it("allows account creation only against loopback Auth, never a hosted project", () => {
    expect(localSupabaseAccountCreationAllowed("http://127.0.0.1:54321")).toBe(
      true,
    );
    expect(
      localSupabaseAccountCreationAllowed("https://project.supabase.co"),
    ).toBe(false);
    expect(
      localSupabaseAccountCreationAllowed("http://user:pass@127.0.0.1:54321"),
    ).toBe(false);
    for (const url of [
      "http://127.0.0.1:54321/other",
      "http://127.0.0.1:54321?project=hosted",
      "http://127.0.0.1:54321#configuration",
    ])
      expect(localSupabaseAccountCreationAllowed(url)).toBe(false);
  });
});

describe("explicit temporary HTTPS setup", () => {
  const httpsConfiguration = {
    ...configuration,
    origin: "https://rivox-test.example",
    temporaryHttps: "true",
    supabaseUrl: "http://127.0.0.1:54321",
  };
  const httpsRequest = (
    host = "rivox-test.example",
    origin = "https://rivox-test.example",
  ) =>
    new Request("http://localhost:3000/api/setup/owner", {
      method: "POST",
      headers: { host, origin },
    });

  it("requires explicit opt-in and isolated local Auth in addition to valid setup credentials", () => {
    expect(localOwnerSetupEnabled(httpsConfiguration, now)).toBe(true);
    expect(temporaryHttpsOwnerSetupEnabled(httpsConfiguration, now)).toBe(true);
    expect(temporaryHttpsOwnerSetupEnabled(configuration, now)).toBe(false);
    for (const overrides of [
      { temporaryHttps: undefined },
      { temporaryHttps: "false" },
      { supabaseUrl: undefined },
      { supabaseUrl: "https://project.supabase.co" },
      { supabaseUrl: "http://auth.remote.example:54321" },
      { enabled: undefined },
      { token: "short" },
      { expiresAt: String(now - 1) },
      { expiresAt: String(now + 2 * 60 * 60 * 1000) },
    ])
      expect(
        localOwnerSetupEnabled({ ...httpsConfiguration, ...overrides }, now),
      ).toBe(false);
  });

  it("rejects noncanonical and insecure public setup origins", () => {
    for (const origin of [
      "http://rivox-test.example",
      "https://rivox-test.example/",
      "https://rivox-test.example:443",
      "https://rivox-test.example/setup/owner",
      "https://rivox-test.example?setup=invalid",
      "https://rivox-test.example#setup=invalid",
      "https://user:password@rivox-test.example",
    ])
      expect(
        localOwnerSetupEnabled({ ...httpsConfiguration, origin }, now),
      ).toBe(false);
  });

  it("requires the configured public Host and Origin even behind a loopback reverse proxy", () => {
    expect(() =>
      assertOwnerSetupAccess(
        httpsRequest(),
        configuration.token,
        httpsConfiguration,
        now,
      ),
    ).not.toThrow();
    for (const request of [
      httpsRequest("attacker.example"),
      httpsRequest("localhost:3000"),
      httpsRequest("rivox-test.example", "https://attacker.example"),
      httpsRequest("rivox-test.example", "http://rivox-test.example"),
      new Request("http://localhost:3000/api/setup/owner"),
    ])
      expect(() =>
        assertOwnerSetupAccess(
          request,
          configuration.token,
          httpsConfiguration,
          now,
        ),
      ).toThrow("configured origin");
    expect(() =>
      assertOwnerSetupAccess(
        httpsRequest(),
        "wrong token",
        httpsConfiguration,
        now,
      ),
    ).toThrow("token was not accepted");
  });
});

describe("intended Owner identity", () => {
  it("does not choose an account or authenticate once an Owner exists", async () => {
    const deps = dependencies();
    deps.ownerExists.mockResolvedValue(true);
    await expect(completeOwnerBootstrap(input, deps)).rejects.toThrow(
      "already has an Owner",
    );
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.bootstrap).not.toHaveBeenCalled();
  });
  it("only bootstraps the account actually authenticated by the operator", async () => {
    const deps = dependencies();
    await completeOwnerBootstrap(input, deps);
    expect(deps.signIn).toHaveBeenCalledWith(input.email, input.password);
    expect(deps.bootstrap).toHaveBeenCalledWith({
      id: "intended-user",
      email: "owner@example.test",
      name: "Intended Owner",
    });
    expect(deps.registerSession).toHaveBeenCalledOnce();
    expect(deps.signOut).not.toHaveBeenCalled();
  });
  it.each([
    { email: "owner@example.test", emailVerified: false },
    { email: "someone-else@example.test", emailVerified: true },
  ])(
    "rejects an unverified or mismatched account and clears its session",
    async (identity) => {
      const deps = dependencies();
      deps.signIn.mockResolvedValue({ id: "unexpected-user", ...identity });
      await expect(completeOwnerBootstrap(input, deps)).rejects.toThrow(
        "email-verified",
      );
      expect(deps.bootstrap).not.toHaveBeenCalled();
      expect(deps.signOut).toHaveBeenCalledOnce();
    },
  );
  it("clears the temporary sign-in if the single-Owner transaction rejects", async () => {
    const deps = dependencies();
    deps.bootstrap.mockRejectedValue(new Error("Owner already exists"));
    await expect(completeOwnerBootstrap(input, deps)).rejects.toThrow(
      "Owner already exists",
    );
    expect(deps.signOut).toHaveBeenCalledOnce();
    expect(deps.registerSession).not.toHaveBeenCalled();
  });
  it("cannot create an account without an explicitly supplied local account adapter", async () => {
    const deps = dependencies();
    await expect(
      completeOwnerBootstrap({ ...input, accountMode: "create-local" }, deps),
    ).rejects.toThrow("isolated local Auth");
    expect(deps.signIn).not.toHaveBeenCalled();
  });
  it("authenticates and verifies the newly created local identity before membership", async () => {
    const deps = {
      ...dependencies(),
      createLocalAccount: vi.fn().mockResolvedValue({ id: "intended-user" }),
    };
    await completeOwnerBootstrap(
      { ...input, accountMode: "create-local" },
      deps,
    );
    expect(deps.createLocalAccount).toHaveBeenCalledWith(
      input.email,
      input.password,
    );
    expect(deps.bootstrap).toHaveBeenCalledOnce();
  });
  it("rejects a different identity returned after local account creation", async () => {
    const deps = {
      ...dependencies(),
      createLocalAccount: vi.fn().mockResolvedValue({ id: "different-user" }),
    };
    await expect(
      completeOwnerBootstrap({ ...input, accountMode: "create-local" }, deps),
    ).rejects.toThrow("email-verified");
    expect(deps.bootstrap).not.toHaveBeenCalled();
  });
});

it("accepts Next internal URL normalization only when actual Host and Origin match the configured loopback origin", () => {
  const token = "a".repeat(43);
  const configuration = {
    enabled: "true",
    token,
    origin: "http://127.0.0.1:3000",
    expiresAt: String(Date.now() + 300000),
  };
  const request = new Request("http://localhost:3000/api/setup/owner", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  });
  expect(() =>
    assertOwnerSetupAccess(request, token, configuration),
  ).not.toThrow();
  const bad = new Request("http://localhost:3000/api/setup/owner", {
    headers: { host: "attacker.example", origin: "http://127.0.0.1:3000" },
  });
  expect(() => assertOwnerSetupAccess(bad, token, configuration)).toThrow(
    "configured origin",
  );
});
