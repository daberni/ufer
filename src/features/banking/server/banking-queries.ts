import { and, desc, eq, ne, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { requisitions, syncRuns } from "@/server/database/schema";
import { environment } from "./environment";
import { linkedTransactionCount } from "./sync-repository";
import { bankingConfigured } from "./enable-banking-client";
import { timestamp } from "@/lib/time";

export function bankingStatus() {
  return {
    environment: environment(),
    configured: bankingConfigured()
  };
}

/** The latest bank connections; pending and linked authorizations past their expiry are reported as expired. */
export async function listConnections() {
  const db = await database();
  const now = timestamp();
  const status = sql<string>`CASE WHEN ${requisitions.status}='PENDING' AND ${requisitions.state_expires_at} < ${now} THEN 'EXPIRED' WHEN ${requisitions.status}='LINKED' AND ${requisitions.valid_until} < ${now} THEN 'EXPIRED' ELSE ${requisitions.status} END`;

  return db.select({
    id: requisitions.id,
    bank_name: requisitions.bank_name,
    bank_country: requisitions.bank_country,
    status,
    valid_until: requisitions.valid_until,
    error: requisitions.error
  }).from(requisitions).where(and(eq(requisitions.environment, environment()), ne(requisitions.status, "REMOVED"))).orderBy(desc(requisitions.created_at)).limit(20);
}

export async function listRecentSyncRuns() {
  const db = await database();

  return db.select({
    id: syncRuns.id,
    started_at: syncRuns.started_at,
    status: syncRuns.status,
    inserted_count: syncRuns.inserted_count,
    // Runs recorded before syncs stamped their rows report inserted rows without any links.
    linked_count: linkedTransactionCount,
    error: syncRuns.error
  }).from(syncRuns).where(eq(syncRuns.environment, environment())).orderBy(desc(syncRuns.started_at)).limit(5);
}

/** A sync run of the current banking environment; undefined for unknown runs and runs of another environment. */
export async function findSyncRun(id: string) {
  const db = await database();

  return db.select({
    id: syncRuns.id,
    started_at: syncRuns.started_at,
    status: syncRuns.status,
    inserted_count: syncRuns.inserted_count
  }).from(syncRuns).where(and(eq(syncRuns.id, id), eq(syncRuns.environment, environment()))).get();
}
