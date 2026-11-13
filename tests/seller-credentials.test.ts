import { afterEach, expect, it, vi } from "vitest";
import {
  encryptSellerSecret,
  decryptSellerSecret,
} from "@/domains/eldorado/credentials";
import { EldoradoClient } from "@/domains/eldorado/client";
afterEach(() => vi.unstubAllEnvs());
it("encrypts with random nonces and binds authentication to this integration's client", () => {
  vi.stubEnv("INVENTORY_ENCRYPTION_KEY", "1".repeat(64));
  const secret = "synthetic-seller-secret",
    client = "fixture-client";
  const first = encryptSellerSecret(secret, client),
    second = encryptSellerSecret(secret, client);
  expect(first).not.toBe(second);
  expect(first).not.toContain(secret);
  expect(decryptSellerSecret(first, client)).toBe(secret);
  expect(() => decryptSellerSecret(first, "other-client")).toThrow(
    "could not be verified",
  );
  const parts = first.split(".");
  parts[2] = Buffer.alloc(16).toString("base64");
  expect(() => decryptSellerSecret(parts.join("."), client)).toThrow(
    "could not be verified",
  );
  vi.stubEnv("INVENTORY_ENCRYPTION_KEY", "2".repeat(64));
  expect(() => decryptSellerSecret(first, client)).toThrow(
    "could not be verified",
  );
});
it("refuses to encrypt with a missing or placeholder master key", () => {
  vi.stubEnv("INVENTORY_ENCRYPTION_KEY", "placeholder");
  expect(() => encryptSellerSecret("fixture", "client")).toThrow(
    "not configured",
  );
});
it("resolves durable credentials on refresh and shares concurrent resolution", async () => {
  let now = 0;
  const credentials = vi.fn(async () => ({
    clientId: "fixture-client",
    clientSecret: now ? "rotated-fixture" : "initial-fixture",
  }));
  const sent: string[] = [];
  const client = new EldoradoClient(
    credentials,
    async (url, options) => {
      if (String(url).endsWith("/token")) {
        sent.push(JSON.parse(String(options?.body)).clientSecret);
        return Response.json({ accessToken: "fixture-token", expiresIn: 900 });
      }
      return Response.json({ results: [] });
    },
    () => now,
  );
  await Promise.all([client.orders(), client.orders()]);
  expect(credentials).toHaveBeenCalledTimes(1);
  now = 841000;
  await client.orders();
  expect(sent).toEqual(["initial-fixture", "rotated-fixture"]);
});
