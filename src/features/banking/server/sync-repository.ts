import { randomUUID } from "node:crypto";
import { and, count, eq, getTableColumns, like, ne, sql, type SQLWrapper } from "drizzle-orm";
import type { Database } from "@/server/database/connection";
import { timestamp } from "@/lib/time";
import { accounts, balanceSnapshots, requisitions, syncRuns, transactions } from "@/server/database/schema";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";

/** What identifies a sync run's transactions: values for one run, or `sync_runs` columns for a correlated query. */
export type SyncRunIdentity = {
  environment: string | SQLWrapper;
  startedAt: string | SQLWrapper;
};

/** The run a sync writes for: its banking environment and start timestamp. */
export type SyncRunStart = {
  environment: string;
  startedAt: string;
};

/**
 * Condition on `transactions` joined with `accounts` that selects the rows a sync run inserted.
 * A sync stores its run's `started_at` as `created_at` on the bank rows it inserts, and updates keep the original value, so for bank rows `created_at` is the start of the importing sync run. The sync lease serializes runs per environment, so no two runs share a start.
 * Rows stored before runs stamped them carry the database clock and match no run; they are deliberately not attributed by time window.
 */
export function syncRunTransactions(run: SyncRunIdentity) {
  return and(eq(accounts.environment, run.environment), eq(transactions.created_at, run.startedAt), like(transactions.provider_reference, "bank:%"));
}

/** Number of transactions a `sync_runs` row inserted. Run counts are derived from it, so the history never reports rows the run cannot show. */
export const linkedTransactionCount = sql<number>`(SELECT COUNT(*) FROM ${transactions} INNER JOIN ${accounts} ON ${eq(accounts.id, transactions.account_id)} WHERE ${syncRunTransactions({
  environment: syncRuns.environment,
  startedAt: syncRuns.started_at
})})`;

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
      inserted_count: linkedTransactionCount,
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

export async function finishSyncRun(db: Database, id: string, status: "PARTIAL" | "SUCCESS" | "FAILED", error: string | null) {
  await db.update(syncRuns).set({
    status,
    finished_at: timestamp(),
    inserted_count: linkedTransactionCount,
    error
  }).where(eq(syncRuns.id, id));
}

export async function recordAccountSyncError(db: Database, id: string, environment: string, error: string) {
  await db.update(accounts).set({
    sync_error: error
  }).where(and(eq(accounts.id, id), eq(accounts.environment, environment)));
}

/** Stores one account's sync result and returns how many of its transactions this run inserted. */
export async function saveSyncedAccount(db: Database, run: SyncRunStart, accountId: string, balance: {
  amount: number;
  date: string
}, entries: CategorizedEntry[]) {
  return db.transaction(async tx => {
    await upsertTransactions(tx, accountId, entries, run.startedAt);
    await tx.update(accounts).set({
      balance_minor: balance.amount,
      balance_date: balance.date,
      last_synced_at: timestamp(),
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
    const inserted = await tx.select({
      count: count()
    }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.account_id, accountId), syncRunTransactions(run))).get();

    return inserted?.count ?? 0;
  });
}
