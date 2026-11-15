import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function equal(a: string, b: string) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new HttpError(503, "Configure SESSION_SECRET with at least 32 characters.");
  return value;
}

export function signedSession(expires: number) {
  const value = String(expires);
  return `${value}.${createHmac("sha256", secret()).update(`login:${value}`).digest("hex")}`;
}

export function validSession(value: string | undefined) {
  if (!value) return false;
  const expires = Number(value.split(".")[0]);
  return Number.isFinite(expires) && expires > Date.now() && equal(value, signedSession(expires));
}

export async function authenticated() {
  if (!process.env.APP_PASSWORD) {
    if (process.env.NODE_ENV === "production") throw new HttpError(503, "APP_PASSWORD is required in production.");
    return true;
  }
  return validSession((await cookies()).get("budget_session")?.value);
}

export async function requireAuth() {
  if (!await authenticated()) throw new HttpError(401, "Sign in to continue.");
}

export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || "http://localhost:3000").origin;
  if (!origin || origin !== expected) throw new HttpError(403, "Invalid request origin.");
}

export async function checkPassword(password: string) {
  const configured = process.env.APP_PASSWORD;
  if (!configured) throw new HttpError(503, "APP_PASSWORD is not configured.");
  // One shared budget for this single-user app prevents bypass via spoofed proxy headers.
  const fingerprint = hash("budget-monitor-login");
  const client = await db();
  const now = Date.now();
  const attempt = await client.execute({ sql: "INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(fingerprint) DO UPDATE SET attempts = CASE WHEN expires_at < ? THEN 1 ELSE attempts + 1 END, expires_at = CASE WHEN expires_at < ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts", args: [fingerprint, now + 900_000, now, now] });
  if (Number(attempt.rows[0].attempts) > 10) throw new HttpError(429, "Too many sign-in attempts. Try again later.");
  const candidate = scryptSync(password, secret(), 32);
  if (!timingSafeEqual(candidate, scryptSync(configured, secret(), 32))) throw new HttpError(401, "Incorrect password.");
  await client.execute({ sql: "DELETE FROM login_attempts WHERE fingerprint = ? OR expires_at < ?", args: [fingerprint, now] });
}

function encryptionKey() {
  const value = process.env.DATA_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new HttpError(503, "DATA_ENCRYPTION_KEY must contain 64 hexadecimal characters.");
  return Buffer.from(value, "hex");
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(item => item.toString("base64url")).join(".");
}

export function decrypt(value: string) {
  const [iv, tag, ciphertext] = value.split(".").map(item => Buffer.from(item, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && secret.length >= 32 && equal(request.headers.get("authorization") || "", `Bearer ${secret}`));
}
