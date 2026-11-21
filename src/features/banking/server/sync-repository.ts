import { anchorOpeningBalance, keepBankOpeningBalanceFirst } from "@/features/accounts/server/opening-balance-repository";
import { comparableBankBalanceTypes } from "@/features/accounts/server/account-queries";
// eslint-disable-next-line boundaries/dependencies -- known violation tracked in daberni/ufer#285
import { adoptImportedRows } from "@/features/imports/server/mapped-import-repository";
import { randomUUID } from "node:crypto";
import { and, count, eq, getTableColumns, isNull, like, ne, sql, type SQLWrapper } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { timestamp } from "@/lib/time";
import { accounts, balanceSnapshots, requisitions, syncRuns, transactions } from "@/server/database/schema";
import { upsertTransactions, withStoredOverrides } from "@/features/transactions/server/transaction-repository";
import type { CategorizedEntry, Entry } from "@/features/transactions/server/transaction-entry";

/** The run a sync writes for: its start timestamp. */
export type SyncRunStart = {
  startedAt: string;
};

/**
 * Condition on `transactions` joined with `accounts` that selects the rows a sync run inserted.
 * A sync stores its run's `started_at` as `created_at` on the bank rows it inserts, and updates keep the original value, so for bank rows `created_at` is the start of the importing sync run. The sync lease serializes runs, so no two runs share a start.
 * Rows stored before runs stamped them carry the database clock and match no run; they are deliberately not attributed by time window.
 */
export function syncRunTransactions(startedAt: string | SQLWrapper) {
  return and(eq(transactions.created_at, startedAt), like(transactions.provider_reference, "bank:%"));
}

/** Number of transactions a `sync_runs` row inserted. Run counts are derived from it, so the history never reports rows the run cannot show. */
export const linkedTransactionCount = sql<number>`(SELECT COUNT(*) FROM ${transactions} INNER JOIN ${accounts} ON ${eq(accounts.id, transactions.account_id)} WHERE ${syncRunTransactions(syncRuns.started_at)})`;

/** Linked bank accounts to sync; archived accounts are skipped until restored, when the sync window covers what they missed. */
export async function listSyncAccounts() {
  const db = await database();

  return db.select({
    ...getTableColumns(accounts),
    connection_id: requisitions.id,
    valid_until: requisitions.valid_until,
    connection_status: requisitions.status
  }).from(accounts).innerJoin(requisitions, eq(requisitions.id, accounts.requisition_id)).where(and(eq(accounts.provider, "enable_banking"), isNull(accounts.archived_at), ne(requisitions.status, "REMOVED")));
}

export async function startSyncRun(id: string, started: string) {
  const db = await database();

  await db.transaction(async tx => {
    await tx.update(syncRuns).set({
      status: "INTERRUPTED",
      finished_at: started,
      inserted_count: linkedTransactionCount,
      error: "The previous sync was interrupted."
    }).where(eq(syncRuns.status, "RUNNING"));
    await tx.insert(syncRuns).values({
      id,
      started_at: started,
      status: "RUNNING"
    });
  });
}

export async function finishSyncRun(id: string, status: "PARTIAL" | "SUCCESS" | "FAILED", error: string | null) {
  const db = await database();

  await db.update(syncRuns).set({
    status,
    finished_at: timestamp(),
    inserted_count: linkedTransactionCount,
    error
  }).where(eq(syncRuns.id, id));
}

/** Marks a run interrupted unless a competing sync already finalized it. */
export async function interruptSyncRun(id: string, error: string) {
  const db = await database();

  await db.update(syncRuns).set({
    status: "INTERRUPTED",
    finished_at: timestamp(),
    inserted_count: linkedTransactionCount,
    error
  }).where(and(eq(syncRuns.id, id), eq(syncRuns.status, "RUNNING")));
}

export async function recordAccountSyncError(id: string, error: string) {
  const db = await database();

  await db.update(accounts).set({
    sync_error: error
  }).where(eq(accounts.id, id));
}

/** Stores one account's sync result, keeps its opening balance in front of its bookings and records the reported balance for comparison; returns how many of its transactions this run inserted. Entries are categorized in the write transaction, with the overrides stored for the rows they update. */
export async function saveSyncedAccount(run: SyncRunStart, accountId: string, balance: {
  amount: number;
  bank_balance_type: string;
  date: string
}, entries: Entry[], categorize: (entries: Awaited<ReturnType<typeof withStoredOverrides<Entry>>>) => CategorizedEntry[]) {
  const db = await database();

  return db.transaction(async tx => {
    const categorized = categorize(await withStoredOverrides(tx, accountId, entries));

    await upsertTransactions(tx, accountId, await adoptImportedRows(tx, accountId, categorized), run.startedAt);

    // Only booked money anchors the opening balance; available or expected balances may include credit lines and pending items.
    if (comparableBankBalanceTypes.includes(balance.bank_balance_type)) {
      await anchorOpeningBalance(tx, accountId, balance, syncRunTransactions(run.startedAt));
    } else {
      await keepBankOpeningBalanceFirst(tx, accountId, syncRunTransactions(run.startedAt));
    }

    await tx.update(accounts).set({
      last_synced_at: timestamp(),
      sync_error: null
    }).where(eq(accounts.id, accountId));
    await tx.insert(balanceSnapshots).values({
      id: randomUUID(),
      account_id: accountId,
      observed_at: balance.date,
      amount_minor: balance.amount,
      bank_balance_type: balance.bank_balance_type,
      source: "sync"
    }).onConflictDoUpdate({
      target: [balanceSnapshots.account_id, balanceSnapshots.observed_at],
      set: {
        amount_minor: balance.amount,
        bank_balance_type: balance.bank_balance_type,
        source: "sync"
      }
    });
    const inserted = await tx.select({
      count: count()
    }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.account_id, accountId), syncRunTransactions(run.startedAt))).get();

    return inserted?.count ?? 0;
  });
}
