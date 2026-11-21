import { and, eq, lt } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { database } from "@/server/database/connection";
import { leases } from "@/server/database/schema";
import { timestamp } from "@/lib/time";

const leaseDuration = Temporal.Duration.from({
  minutes: 12
});

export async function acquireLease(name: string, owner: string, now = Temporal.Now.instant()) {
  const db = await database();

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

export async function renewLease(name: string, owner: string) {
  const db = await database();

  const result = await db.update(leases).set({
    expires_at: timestamp(Temporal.Now.instant().add(leaseDuration))
  }).where(and(eq(leases.name, name), eq(leases.owner, owner))).returning({
    owner: leases.owner
  });

  return result.length === 1;
}

export async function releaseLease(name: string, owner: string) {
  const db = await database();

  await db.delete(leases).where(and(eq(leases.name, name), eq(leases.owner, owner)));
}
