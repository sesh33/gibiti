import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";

export type SellerCredentials = { clientId: string; clientSecret: string };
const purpose = "rivox/eldorado-credentials/v1";
function key() {
  const master = process.env.INVENTORY_ENCRYPTION_KEY;
  if (!master || !/^[a-f\d]{64}$/i.test(master))
    throw new AppError(
      "ENCRYPTION_NOT_CONFIGURED",
      "Server encryption is not configured.",
      503,
    );
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(master, "hex"),
      Buffer.alloc(0),
      purpose,
      32,
    ),
  );
}
export function encryptSellerSecret(secret: string, clientId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${purpose}:${clientId}`));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptSellerSecret(envelope: string, clientId: string) {
  const encryptionKey = key();
  try {
    const [version, nonce, tag, encrypted, ...extra] = envelope.split(".");
    if (version !== "v1" || !nonce || !tag || !encrypted || extra.length)
      throw new Error();
    const iv = Buffer.from(nonce, "base64"),
      authTag = Buffer.from(tag, "base64");
    if (iv.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
    decipher.setAAD(Buffer.from(`${purpose}:${clientId}`));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "INTEGRATION_INTEGRITY_ERROR",
      "The stored integration could not be verified. Ask your Owner to reconnect it.",
      503,
    );
  }
}
export function sellerClientId() {
  const id = process.env.ELDORADO_CLIENT_ID;
  if (!id)
    throw new AppError(
      "INTEGRATION_NOT_CONFIGURED",
      "The Owner must configure the Eldorado integration.",
      503,
    );
  return id;
}
async function storedCredentials() {
  // Environment-only local use needs no service binding. Hosted use always
  // checks the durable record first, including after a serverless cold start.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data, error } = await supabaseAdmin()
    .from("integration_credentials")
    .select("client_id,encrypted_secret,verified_at,verified_origin")
    .eq("provider", "eldorado")
    .maybeSingle();
  if (error)
    throw new AppError(
      "INTEGRATION_STORE_UNAVAILABLE",
      "Integration configuration could not be loaded. Try again later.",
      503,
    );
  return data as {
    client_id: string;
    encrypted_secret: string;
    verified_at: string;
    verified_origin: string | null;
  } | null;
}
export async function sellerConnectionStatus() {
  const row = await storedCredentials();
  return {
    configured: Boolean(
      row
        ? row.client_id === process.env.ELDORADO_CLIENT_ID
        : process.env.ELDORADO_CLIENT_ID && process.env.ELDORADO_CLIENT_SECRET,
    ),
    verifiedAt: row?.verified_at ?? null,
    verifiedOrigin: row?.verified_origin ?? null,
    clientId: process.env.ELDORADO_CLIENT_ID ?? null,
  };
}
export async function resolveSellerCredentials(): Promise<SellerCredentials> {
  const clientId = sellerClientId(),
    row = await storedCredentials();
  if (row) {
    if (row.client_id !== clientId)
      throw new AppError(
        "INTEGRATION_ACCOUNT_MISMATCH",
        "The configured client has changed. The Owner must reconnect Eldorado.",
        503,
      );
    return {
      clientId,
      clientSecret: decryptSellerSecret(row.encrypted_secret, clientId),
    };
  }
  const clientSecret = process.env.ELDORADO_CLIENT_SECRET;
  if (!clientSecret)
    throw new AppError(
      "INTEGRATION_NOT_CONFIGURED",
      "The Owner must connect Eldorado in Settings before synchronizing.",
      503,
    );
  return { clientId, clientSecret };
}
