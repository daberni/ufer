import { eq, lt, or, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { loginAttempts } from "@/server/database/schema";

export async function recordLoginAttempt(fingerprint: string, now: number) {
  const db = await database();
  const result = await db.insert(loginAttempts).values({
    fingerprint,
    attempts: 1,
    expires_at: now + 900_000
  }).onConflictDoUpdate({
    target: loginAttempts.fingerprint,
    set: {
      attempts: sql`CASE WHEN ${loginAttempts.expires_at} < ${now} THEN 1 ELSE ${loginAttempts.attempts} + 1 END`,
      expires_at: sql`CASE WHEN ${loginAttempts.expires_at} < ${now} THEN excluded.expires_at ELSE ${loginAttempts.expires_at} END`
    }
  }).returning({
    attempts: loginAttempts.attempts
  }).get();

  if (!result) {
    throw new Error("The sign-in attempt could not be recorded.");
  }

  return result.attempts;
}

export async function clearLoginAttempts(fingerprint: string, now: number) {
  const db = await database();

  await db.delete(loginAttempts).where(or(eq(loginAttempts.fingerprint, fingerprint), lt(loginAttempts.expires_at, now)));
}
