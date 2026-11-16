import { and, eq, lt } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { Database } from "@/server/database/connection";
import { leases } from "@/server/database/schema";
import { timestamp } from "@/lib/time";

const leaseDuration = Temporal.Duration.from({
  minutes: 12
});

export async function acquireLease(db: Database, name: string, owner: string, now = Temporal.Now.instant()) {
  const expires = timestamp(now.add(leaseDuration));
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
    setWhere: lt(leases.expires_at, timestamp(now))
  }).returning({
    owner: leases.owner
  });

  return result.length === 1;
}

export async function renewLease(db: Database, name: string, owner: string) {
  const result = await db.update(leases).set({
    expires_at: timestamp(Temporal.Now.instant().add(leaseDuration))
  }).where(and(eq(leases.name, name), eq(leases.owner, owner))).returning({
    owner: leases.owner
  });

  return result.length === 1;
}

export async function releaseLease(db: Database, name: string, owner: string) {
  await db.delete(leases).where(and(eq(leases.name, name), eq(leases.owner, owner)));
}
