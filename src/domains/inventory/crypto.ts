import "server-only";
import { randomBytes, createCipheriv } from "node:crypto";
import { AppError } from "@/lib/errors";
export function encryptInventorySecret(
  value: string,
  keyHex = process.env.INVENTORY_ENCRYPTION_KEY,
) {
  if (!keyHex || !/^[a-fA-F0-9]{64}$/.test(keyHex))
    throw new AppError(
      "ENCRYPTION_NOT_CONFIGURED",
      "Configure a 32-byte inventory encryption key before storing sensitive delivery data.",
      503,
    );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function inventoryKeyAvailable() {
  return Boolean(
    process.env.INVENTORY_ENCRYPTION_KEY &&
    /^[a-fA-F0-9]{64}$/.test(process.env.INVENTORY_ENCRYPTION_KEY),
  );
}
export async function decryptInventorySecret(
  payload: string,
  keyHex = process.env.INVENTORY_ENCRYPTION_KEY,
) {
  if (!keyHex || !/^[a-fA-F0-9]{64}$/.test(keyHex))
    throw new AppError(
      "ENCRYPTION_NOT_CONFIGURED",
      "Inventory decryption is not configured.",
      503,
    );
  const [version, iv, tag, encrypted, ...extra] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra.length)
    throw new AppError(
      "INVENTORY_INTEGRITY_ERROR",
      "Delivery data integrity verification failed.",
      500,
    );
  try {
    const { createDecipheriv } = await import("node:crypto");
    const nonce = Buffer.from(iv, "base64"),
      authTag = Buffer.from(tag, "base64");
    if (nonce.length !== 12 || authTag.length !== 16)
      throw new Error("Invalid envelope");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(keyHex, "hex"),
      nonce,
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "INVENTORY_INTEGRITY_ERROR",
      "Delivery data integrity verification failed.",
      500,
    );
  }
}
