import { and, count, inArray, isNotNull, like, ne, not, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, balanceSnapshots, categories, categorizationRules, requisitions, transactions } from "@/server/database/schema";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import { pairTransfers } from "@/features/transactions/server/transfer-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";
import type { CategorizationRule, Category } from "@/server/database/models";
import { demoIdPrefix, type DemoAccountDefinition, type DemoCategory } from "./demo-catalog";
import type { DemoSnapshot } from "./demo-dataset";

/** What the guard inspects before demo rows are replaced. */
export type DemoSeedTarget = {
  otherEnvironmentRows: number;
  foreignManualTransactions: number;
};

export type DemoAccountRows = DemoAccountDefinition & {
  balance: number;
  balanceDate: string;
  entries: CategorizedEntry[];
  snapshots: DemoSnapshot[];
};

export type DemoSeedRows = {
  environment: string;
  categories: DemoCategory[];
  rules: CategorizationRule[];
  accounts: DemoAccountRows[];
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

async function inspectTarget(tx: DatabaseTransaction, environment: string): Promise<DemoSeedTarget> {
  const otherAccounts = await tx.select({
    count: count()
  }).from(accounts).where(ne(accounts.environment, environment)).get();
  const otherRequisitions = await tx.select({
    count: count()
  }).from(requisitions).where(ne(requisitions.environment, environment)).get();
  // Bank-connected sandbox accounts may coexist with the demo; manual and CSV accounts hold data someone entered.
  const foreignManualAccounts = tx.select({
    id: accounts.id
  }).from(accounts).where(and(not(like(accounts.id, demoRows)), ne(accounts.provider, "enable_banking")));
  const manualTransactions = await tx.select({
    count: count()
  }).from(transactions).where(inArray(transactions.account_id, foreignManualAccounts)).get();

  return {
    otherEnvironmentRows: (otherAccounts?.count ?? 0) + (otherRequisitions?.count ?? 0),
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
  await tx.delete(categorizationRules).where(like(categorizationRules.id, demoRows));
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

async function insertAccount(tx: DatabaseTransaction, environment: string, account: DemoAccountRows) {
  await tx.insert(accounts).values({
    id: account.id,
    environment,
    name: account.name,
    institution: account.institution,
    kind: account.kind,
    currency: "EUR",
    provider: "manual",
    balance_minor: account.balance,
    balance_date: account.balanceDate
  });
  await upsertTransactions(tx, account.id, account.entries);

  if (account.snapshots.length) {
    await tx.insert(balanceSnapshots).values(account.snapshots.map(snapshot => ({
      id: `${account.id}-${snapshot.date}`,
      account_id: account.id,
      observed_at: snapshot.date,
      amount_minor: snapshot.amount,
      source: "manual" as const
    })));
  }
}

/**
 * Replaces every demo-owned row in one transaction. `verify` receives the guard inspection inside the same transaction and throws to abort before anything is written.
 */
export async function replaceDemoRows(rows: DemoSeedRows, verify: (target: DemoSeedTarget) => void) {
  const db = await database();

  await db.transaction(async tx => {
    verify(await inspectTarget(tx, rows.environment));

    await deleteDemoRows(tx);
    await upsertCategories(tx, rows.categories);

    if (rows.rules.length) {
      await tx.insert(categorizationRules).values(rows.rules);
    }

    for (const account of rows.accounts) {
      await insertAccount(tx, rows.environment, account);
    }

    await pairTransfers(tx, rows.environment);
  });
}

/** Counts of the demo rows currently stored, for the command summary. */
export async function countDemoRows() {
  const db = await database();
  const transactionCounts = await db.select({
    total: count(),
    uncategorized: sql<number>`SUM(CASE WHEN ${transactions.category_id} IS NULL THEN 1 ELSE 0 END)`
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
