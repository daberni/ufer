import { and, count, eq, inArray, isNotNull, like, ne, not, notInArray, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, balanceSnapshots, categories, categorizationRules, requisitions, syncRuns, transactions } from "@/server/database/schema";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import { recordManualBalance } from "@/features/transactions/server/manual-transaction-repository";
import { manualAccountTypes } from "@/lib/transaction-types";
import { createTransferCounterpart } from "@/features/transactions/server/transfer-link-repository";
import { pairTransfers } from "@/features/transactions/server/transfer-pairing-repository";
import { writeSplit } from "@/features/transactions/server/split-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";
import type { Category } from "@/server/database/models";
import type { Rule } from "@/lib/rules";
import { requireRuleCapacity } from "@/features/categorization/server/rule-repository";
import { demoConnections, demoIdPrefix, type DemoAccountDefinition, type DemoCategory } from "./demo-catalog";
import type { DemoConnectionData, DemoCreatedCounterpart, DemoSnapshot, DemoSplit, DemoSyncRun } from "./demo-dataset";

/** What the guard inspects before demo rows are replaced. */
export type DemoSeedTarget = {
  foreignManualTransactions: number;
};

export type DemoAccountRows = DemoAccountDefinition & {
  opening: DemoSnapshot;
  entries: CategorizedEntry[];
  valuations: DemoSnapshot[];
  reported: DemoSnapshot;
};

export type DemoSeedRows = {
  categories: DemoCategory[];
  rules: Rule[];
  accounts: DemoAccountRows[];
  createdCounterparts: DemoCreatedCounterpart[];
  splits: DemoSplit[];
  connections: DemoConnectionData[];
  syncRuns: DemoSyncRun[];
  lastSyncedAt: string;
};

const demoRows = `${demoIdPrefix}%`;

/** Categories the seed did not create; the seed reuses one of them instead of adding a demo category with the same name. */
export async function listForeignCategories(): Promise<Pick<Category, "id" | "name">[]> {
  const db = await database();

  return db.select({
    id: categories.id,
    name: categories.name
  }).from(categories).where(not(like(categories.id, demoRows)));
}

async function inspectTarget(tx: DatabaseTransaction): Promise<DemoSeedTarget> {
  // Bank-connected sandbox accounts may coexist with the demo; manual and CSV accounts hold data someone entered. Their opening balances and adjustments only record balances and do not count.
  const foreignManualAccounts = tx.select({
    id: accounts.id
  }).from(accounts).where(and(not(like(accounts.id, demoRows)), ne(accounts.provider, "enable_banking")));
  const manualTransactions = await tx.select({
    count: count()
  }).from(transactions).where(and(inArray(transactions.account_id, foreignManualAccounts), notInArray(transactions.type, [...manualAccountTypes]))).get();

  return {
    foreignManualTransactions: manualTransactions?.count ?? 0
  };
}

async function deleteDemoRows(tx: DatabaseTransaction) {
  const demoTransfers = tx.select({
    transfer_id: transactions.transfer_id
  }).from(transactions).where(and(like(transactions.account_id, demoRows), isNotNull(transactions.transfer_id)));

  // A synced sandbox booking linked to a demo booking stays a transfer without a counterpart.
  await tx.update(transactions).set({
    transfer_id: null
  }).where(and(not(like(transactions.account_id, demoRows)), inArray(transactions.transfer_id, demoTransfers)));
  await tx.delete(transactions).where(like(transactions.account_id, demoRows));
  await tx.delete(balanceSnapshots).where(like(balanceSnapshots.account_id, demoRows));
  await tx.delete(accounts).where(like(accounts.id, demoRows));
  await tx.delete(requisitions).where(like(requisitions.id, demoRows));
  await tx.delete(syncRuns).where(like(syncRuns.id, demoRows));
  await tx.delete(categorizationRules).where(like(categorizationRules.id, demoRows));
  // A person's transfer rule that names a removed demo account keeps its transfer type without a counterpart account.
  await tx.update(categorizationRules).set({
    transfer_account_id: null
  }).where(like(categorizationRules.transfer_account_id, demoRows));
  // A booking a rule sent to a removed demo account stays unpairable rather than pairing with any account.
  await tx.update(transactions).set({
    type_transfer_account_id: sql`'removed:' || ${transactions.type_transfer_account_id}`
  }).where(like(transactions.type_transfer_account_id, demoRows));
}

// Demo categories are updated in place because synced sandbox transactions may already reference them.
async function upsertCategories(tx: DatabaseTransaction, rows: DemoCategory[]) {
  for (const category of rows) {
    await tx.insert(categories).values(category).onConflictDoUpdate({
      target: categories.id,
      set: {
        name: category.name,
        color: category.color,
        icon: category.icon
      }
    });
  }
}

/**
 * Simulated connections are linked but hold no provider session, so removing one revokes nothing; sync skips demo accounts, so none is ever requested from a provider.
 */
async function insertConnections(tx: DatabaseTransaction, rows: DemoConnectionData[]) {
  for (const connection of rows) {
    await tx.insert(requisitions).values({
      id: connection.id,
      bank_name: connection.bankName,
      bank_country: "AT",
      status: "LINKED",
      valid_until: connection.validUntil,
      created_at: connection.grantedAt
    });
  }
}

async function insertAccount(tx: DatabaseTransaction, account: DemoAccountRows, lastSyncedAt: string) {
  const bank = account.bank;

  await tx.insert(accounts).values({
    id: account.id,
    name: account.name,
    institution: account.institution,
    kind: account.kind,
    currency: "EUR",
    provider: bank ? "enable_banking" : "manual",
    provider_name: bank ? account.name : null,
    provider_uid: bank ? `${account.id}-uid` : null,
    requisition_id: bank ? demoConnections[bank.connection].id : null,
    iban: bank?.iban ?? null,
    last_synced_at: bank ? lastSyncedAt : null
  });
  await recordManualBalance(tx, demoAccount(account), account.opening.date, account.opening.amount);
  await upsertTransactions(tx, account.id, account.entries);

  if (bank) {
    await tx.insert(balanceSnapshots).values({
      id: `${account.id}-balance`,
      account_id: account.id,
      observed_at: account.reported.date,
      amount_minor: account.reported.amount,
      bank_balance_type: "CLBD",
      source: "sync"
    });
  }
}

async function insertSplits(tx: DatabaseTransaction, splits: DemoSplit[]) {
  for (const split of splits) {
    const booking = await tx.select({
      id: transactions.id
    }).from(transactions).where(and(eq(transactions.account_id, split.accountId), eq(transactions.provider_reference, split.reference))).get();

    if (!booking) {
      throw new Error("A demo split refers to a booking the seed did not store.");
    }

    await writeSplit(tx, booking.id, () => split.parts.map(part => ({
      amount: part.amount,
      categoryId: part.categoryId,
      note: part.note
    })));
  }
}

function demoAccount(account: DemoAccountRows) {
  return {
    id: account.id,
    currency: "EUR"
  };
}

/**
 * Replaces every demo-owned row in one transaction. `verify` receives the guard inspection inside the same transaction and throws to abort before anything is written.
 */
export async function replaceDemoRows(rows: DemoSeedRows, verify: (target: DemoSeedTarget) => void) {
  const db = await database();

  await db.transaction(async tx => {
    verify(await inspectTarget(tx));

    await deleteDemoRows(tx);
    await upsertCategories(tx, rows.categories);

    if (rows.rules.length) {
      await requireRuleCapacity(tx, rows.rules.length);
      await tx.insert(categorizationRules).values(rows.rules);
    }

    await insertConnections(tx, rows.connections);

    for (const account of rows.accounts) {
      await insertAccount(tx, account, rows.lastSyncedAt);
    }

    await insertSplits(tx, rows.splits);
    await tx.insert(syncRuns).values(rows.syncRuns.map(run => ({
      id: run.id,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      status: run.status,
      inserted_count: run.insertedCount,
      error: run.error
    })));

    for (const counterpart of rows.createdCounterparts) {
      await createTransferCounterpart(tx, counterpart.sourceAccountId, counterpart.sourceReference, counterpart.accountId);
    }

    await pairTransfers(tx);

    // Valuations follow every transaction, including created counterparts, as when a person updates a balance.
    for (const account of rows.accounts) {
      for (const valuation of account.valuations) {
        await recordManualBalance(tx, demoAccount(account), valuation.date, valuation.amount);
      }
    }
  });
}

/** Counts of the demo rows currently stored, for the command summary. */
export async function countDemoRows() {
  const db = await database();
  const transactionCounts = await db.select({
    total: count(),
    // Opening balances and adjustments have no purpose to categorize.
    uncategorized: sql<number>`SUM(CASE WHEN ${transactions.category_id} IS NULL AND ${notInArray(transactions.type, [...manualAccountTypes])} THEN 1 ELSE 0 END)`
  }).from(transactions).where(like(transactions.account_id, demoRows)).get();
  const accountCount = await db.select({
    count: count()
  }).from(accounts).where(like(accounts.id, demoRows)).get();
  const ruleCount = await db.select({
    count: count()
  }).from(categorizationRules).where(like(categorizationRules.id, demoRows)).get();

  return {
    accounts: accountCount?.count ?? 0,
    transactions: transactionCounts?.total ?? 0,
    uncategorized: Number(transactionCounts?.uncategorized ?? 0),
    rules: ruleCount?.count ?? 0
  };
}
