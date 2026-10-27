import { describe, it, expect, vi, afterEach } from "vitest";
import {
  effectivePermissions,
  mayReadOrder,
  rolePermissions,
  roles,
} from "@/domains/authorization/permissions";
import { requireSameOrigin, readBody } from "@/lib/http";
import { calculateMetrics } from "@/domains/analytics/service";
import { MockMessagingProvider } from "@/domains/messaging/mock";
import { UnavailableMessagingProvider } from "@/domains/messaging/provider";
import { encryptInventorySecret } from "@/domains/inventory/crypto";
import { createDecipheriv } from "node:crypto";
afterEach(() => vi.unstubAllEnvs());
describe("authorization boundaries", () => {
  it("does not grant cancellation or price changes to fulfillment", () => {
    const granted = effectivePermissions("FULFILLMENT_AGENT");
    expect(granted.has("orders.cancel")).toBe(false);
    expect(granted.has("offers.update_price")).toBe(false);
    expect(granted.has("orders.deliver")).toBe(true);
  });
  it("honors explicit denies and only permits assigned reads for restricted staff", () => {
    const granted = effectivePermissions("SUPPORT_AGENT", [
      { permission: "orders.read", allowed: true },
      { permission: "orders.read", allowed: false },
    ]);
    expect(mayReadOrder(granted, "agent", "other")).toBe(false);
    expect(mayReadOrder(granted, "agent", "agent")).toBe(true);
  });
  it("keeps known role defaults defined", () => {
    for (const role of roles) expect(rolePermissions[role]).toBeDefined();
  });
});
describe("request and data safety", () => {
  it("rejects cross-origin writes", () => {
    vi.stubEnv("APP_ORIGIN", "https://rivox.example");
    expect(() =>
      requireSameOrigin(
        new Request("https://rivox.example/api", {
          headers: {
            origin: "https://attacker.example",
            "content-type": "application/json",
          },
        }),
      ),
    ).toThrow("origin");
  });
  it("enforces the streamed body limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(70000) }),
    });
    await expect(readBody(request)).rejects.toThrow("too large");
  });
  it("does not combine currencies or count unpaid order values as completed volume", () => {
    const result = calculateMetrics([
      { amount: 10, currency: "USD", state: "Completed", purchased_at: "" },
      { amount: 20, currency: "EUR", state: "Completed", purchased_at: "" },
      { amount: 100, currency: "USD", state: "Paid", purchased_at: "" },
    ]);
    expect(result.completedVolume).toEqual({ USD: 10, EUR: 20 });
    expect(result.pending).toBe(1);
  });
  it("encrypts inventory payloads with authenticated, random nonces", () => {
    const key = "ab".repeat(32),
      plaintext = "synthetic inventory content";
    const a = encryptInventorySecret(plaintext, key),
      b = encryptInventorySecret(plaintext, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain(plaintext);
    const [, iv, tag, payload] = a.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    expect(
      Buffer.concat([
        decipher.update(Buffer.from(payload, "base64")),
        decipher.final(),
      ]).toString(),
    ).toBe(plaintext);
  });
});
describe("messaging capability gates", () => {
  it("never enables mocks in production, even with an opt-in flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RIVOX_DEV_MOCKS", "true");
    await expect(new MockMessagingProvider().list()).rejects.toThrow(
      "development-only",
    );
  });
  it("blocks unavailable providers from sending", async () => {
    await expect(new UnavailableMessagingProvider().send()).rejects.toThrow(
      "disabled",
    );
  });
  it("labels development fixtures and retains synthetic messages only in mock memory", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RIVOX_DEV_MOCKS", "true");
    const provider = new MockMessagingProvider();
    const [conversation] = await provider.list();
    expect(provider.kind).toBe("mock");
    await provider.send(conversation.id, "Synthetic response");
    expect((await provider.messages(conversation.id)).at(-1)?.text).toBe(
      "Synthetic response",
    );
  });
});

it("rejects tampered inventory ciphertext without exposing the plaintext", async () => {
  const { decryptInventorySecret } = await import("@/domains/inventory/crypto");
  const key = "cd".repeat(32);
  const encrypted = encryptInventorySecret("synthetic delivery data", key);
  const parts = encrypted.split(".");
  parts[3] = Buffer.from("tampered fixture").toString("base64");
  await expect(decryptInventorySecret(parts.join("."), key)).rejects.toThrow(
    "integrity verification failed",
  );
});
