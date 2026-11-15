import { and, eq, lt } from "drizzle-orm";
import type { Database } from "@/server/database/connection";
import { leases } from "@/server/database/schema";

export async function acquireLease(db: Database, name: string, owner: string, now = new Date()) {
  const expires = new Date(now.getTime() + 12 * 60_000).toISOString();
  const result = await db.insert(leases).values({
    name,
    owner,
    expires_at: expires
  }).onConflictDoUpdate({
    target: leases.name,
    set: {
      owner,
      expires_at: expires
    },
    setWhere: lt(leases.expires_at, now.toISOString())
  }).returning({
    owner: leases.owner
  });

  return result.length === 1;
}

export async function renewLease(db: Database, name: string, owner: string) {
  const result = await db.update(leases).set({
    expires_at: new Date(Date.now() + 12 * 60_000).toISOString()
  }).where(and(eq(leases.name, name), eq(leases.owner, owner))).returning({
    owner: leases.owner
  });

  return result.length === 1;
}

export async function releaseLease(db: Database, name: string, owner: string) {
  await db.delete(leases).where(and(eq(leases.name, name), eq(leases.owner, owner)));
}
