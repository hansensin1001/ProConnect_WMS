import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type { CarrierCredentials } from "./types";

const VERSION = "v1";

function encryptionKey() {
  const value = process.env.CARRIER_CREDENTIALS_ENCRYPTION_KEY;
  if (!value) throw new Error("Carrier credential encryption is not configured. Add CARRIER_CREDENTIALS_ENCRYPTION_KEY in Vercel.");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("CARRIER_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte base64 value or 64-character hexadecimal value.");
  return key;
}

/** AES-256-GCM envelope. Credentials never leave a server API response. */
export function encryptCredentials(credentials: CarrierCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCredentials(envelope: string): CarrierCredentials {
  const [version, ivValue, tagValue, encryptedValue, ...rest] = envelope.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || rest.length) throw new Error("Stored carrier credentials are invalid.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
    const value = JSON.parse(decrypted);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid credential payload");
    return value as CarrierCredentials;
  } catch {
    throw new Error("Stored carrier credentials cannot be decrypted. Verify CARRIER_CREDENTIALS_ENCRYPTION_KEY has not changed.");
  }
}
