import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "@/lib/errors";

// This format is persisted in bank connections; changing it requires a data migration.
const authTagLength = 16;

function encryptionKey() {
  const value = process.env.DATA_ENCRYPTION_KEY || "";

  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new HttpError(503, "DATA_ENCRYPTION_KEY must contain 64 hexadecimal characters.");
  }

  return Buffer.from(value, "hex");
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv, {
    authTagLength
  });
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return [iv, cipher.getAuthTag(), ciphertext].map(item => item.toString("base64url")).join(".");
}

export function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split(".").map(item => Buffer.from(item, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv, {
    authTagLength
  });

  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
