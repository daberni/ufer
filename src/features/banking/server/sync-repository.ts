import { randomUUID } from "node:crypto";
import { and, count, eq, getTableColumns, ne } from "drizzle-orm";
import type { Database } from "@/server/database/connection";
import { accounts, balanceSnapshots, requisitions, syncRuns, transactions } from "@/server/database/schema";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";

export async function listSyncAccounts(db: Database, environment: string) {
  return db.select({
    ...getTableColumns(accounts),
    connection_id: requisitions.id,
    valid_until: requisitions.valid_until,
    connection_status: requisitions.status
  }).from(accounts).innerJoin(requisitions, eq(requisitions.id, accounts.requisition_id)).where(and(eq(accounts.environment, environment), eq(accounts.provider, "enable_banking"), ne(requisitions.status, "REMOVED")));
}

export async function startSyncRun(db: Database, environment: string, id: string, started: string) {
  await db.transaction(async tx => {
    await tx.update(syncRuns).set({
      status: "INTERRUPTED",
      finished_at: started,
      error: "The previous sync was interrupted."
    }).where(and(eq(syncRuns.environment, environment), eq(syncRuns.status, "RUNNING")));
    await tx.insert(syncRuns).values({
      id,
      environment,
      started_at: started,
      status: "RUNNING"
    });
  });
}

export async function finishSyncRun(db: Database, id: string, status: "PARTIAL" | "SUCCESS" | "FAILED", inserted: number, error: string | null) {
  await db.update(syncRuns).set({
    status,
    finished_at: new Date().toISOString(),
    inserted_count: inserted,
    error
  }).where(eq(syncRuns.id, id));
}

export async function recordAccountSyncError(db: Database, id: string, environment: string, error: string) {
  await db.update(accounts).set({
    sync_error: error
  }).where(and(eq(accounts.id, id), eq(accounts.environment, environment)));
}

export async function saveSyncedAccount(db: Database, accountId: string, balance: {
  amount: number;
  date: string
}, entries: CategorizedEntry[]) {
  return db.transaction(async tx => {
    const before = await tx.select({
      count: count()
    }).from(transactions).where(eq(transactions.account_id, accountId)).get();

    await upsertTransactions(tx, accountId, entries);
    await tx.update(accounts).set({
      balance_minor: balance.amount,
      balance_date: balance.date,
      last_synced_at: new Date().toISOString(),
      sync_error: null
    }).where(eq(accounts.id, accountId));
    await tx.insert(balanceSnapshots).values({
      id: randomUUID(),
      account_id: accountId,
      observed_at: balance.date,
      amount_minor: balance.amount,
      source: "sync"
    }).onConflictDoUpdate({
      target: [balanceSnapshots.account_id, balanceSnapshots.observed_at],
      set: {
        amount_minor: balance.amount
      }
    });
    const after = await tx.select({
      count: count()
    }).from(transactions).where(eq(transactions.account_id, accountId)).get();

    return (after?.count ?? 0) - (before?.count ?? 0);
  });
}
