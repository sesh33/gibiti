import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";

export type OwnerBootstrapConfiguration = {
  enabled?: string;
  token?: string;
  origin?: string;
  expiresAt?: string;
};

export function bootstrapConfiguration(): OwnerBootstrapConfiguration {
  return {
    enabled: process.env.RIVOX_BOOTSTRAP_ENABLED,
    token: process.env.RIVOX_BOOTSTRAP_TOKEN,
    origin: process.env.APP_ORIGIN,
    expiresAt: process.env.RIVOX_BOOTSTRAP_EXPIRES_AT,
  };
}

export function localOwnerSetupEnabled(
  configuration = bootstrapConfiguration(),
  now = Date.now(),
): boolean {
  if (
    configuration.enabled !== "true" ||
    !configuration.token ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(configuration.token)
  )
    return false;
  try {
    const origin = new URL(configuration.origin || "");
    if (
      origin.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      return false;
    const expiration = Number(configuration.expiresAt);
    return (
      Number.isFinite(expiration) &&
      expiration > now &&
      expiration - now <= 60 * 60 * 1000
    );
  } catch {
    return false;
  }
}

export function assertOwnerSetupAccess(
  request: Request,
  suppliedToken: string,
  configuration = bootstrapConfiguration(),
  now = Date.now(),
): void {
  if (!localOwnerSetupEnabled(configuration, now))
    throw new AppError(
      "OWNER_SETUP_DISABLED",
      "Owner setup is disabled. Run the private local setup launcher.",
      403,
    );
  const expectedOrigin = new URL(configuration.origin!).origin;
  if (
    (request.headers.get("host") || new URL(request.url).host) !==
      new URL(expectedOrigin).host ||
    request.headers.get("origin") !== expectedOrigin
  )
    throw new AppError(
      "INVALID_ORIGIN",
      "Owner setup accepts requests only from its configured loopback origin.",
      403,
    );
  // Hash both values before comparing so no input-dependent token-length check is exposed.
  const expected = createHash("sha256").update(configuration.token!).digest();
  const supplied = createHash("sha256").update(suppliedToken).digest();
  if (!timingSafeEqual(expected, supplied))
    throw new AppError(
      "OWNER_SETUP_UNAUTHORIZED",
      "The private setup token was not accepted.",
      401,
    );
}

export function localSupabaseAccountCreationAllowed(
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  try {
    const parsed = new URL(url || "");
    return (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export type IntendedOwner = {
  id: string;
  email: string;
  emailVerified: boolean;
};
export type OwnerBootstrapDependencies = {
  ownerExists(): Promise<boolean>;
  signIn(email: string, password: string): Promise<IntendedOwner>;
  createLocalAccount?(email: string, password: string): Promise<{ id: string }>;
  bootstrap(owner: { id: string; email: string; name: string }): Promise<void>;
  registerSession(): Promise<void>;
  signOut(): Promise<void>;
};

/** Never selects an owner from a directory: only the account authenticated by the operator can be claimed. */
export async function completeOwnerBootstrap(
  input: {
    email: string;
    password: string;
    name: string;
    accountMode?: "existing" | "create-local";
  },
  dependencies: OwnerBootstrapDependencies,
): Promise<void> {
  if (await dependencies.ownerExists())
    throw new AppError(
      "OWNER_ALREADY_EXISTS",
      "This workspace already has an Owner. Sign in with an authorized account.",
      409,
    );
  let signedIn = false;
  let createdId: string | undefined;
  if (input.accountMode === "create-local") {
    if (!dependencies.createLocalAccount)
      throw new AppError(
        "LOCAL_ACCOUNT_CREATION_DISABLED",
        "Account creation is available only against the isolated local Auth service.",
        403,
      );
    createdId = (
      await dependencies.createLocalAccount(input.email, input.password)
    ).id;
  }
  try {
    const owner = await dependencies.signIn(input.email, input.password);
    signedIn = true;
    if (
      !owner.emailVerified ||
      owner.email.toLowerCase() !== input.email.toLowerCase() ||
      (createdId && owner.id !== createdId)
    )
      throw new AppError(
        "OWNER_IDENTITY_UNVERIFIED",
        "Use an existing, email-verified Supabase Auth account that you control.",
        403,
      );
    await dependencies.bootstrap({
      id: owner.id,
      email: owner.email,
      name: input.name,
    });
    await dependencies.registerSession();
  } catch (error) {
    if (signedIn) await dependencies.signOut().catch(() => undefined);
    throw error;
  }
}
