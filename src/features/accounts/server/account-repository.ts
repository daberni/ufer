import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { bookManualEntry, recordManualBalance, type ManualEntryResult } from "@/features/transactions/server/manual-transaction-repository";
import type { ManualAccountInput } from "./account-schema";

export async function findManualAccount(id: string) {
  const db = await database();
  const scope = and(eq(accounts.id, id), eq(accounts.environment, environment()), eq(accounts.provider, "manual"));

  return db.select().from(accounts).where(scope).get();
}

/** Creates a manual account with its starting balance as the opening balance transaction. */
export async function insertManualAccount(input: ManualAccountInput, amount: number, date: string) {
  const db = await database();
  const id = randomUUID();

  await db.transaction(async tx => {
    await tx.insert(accounts).values({
      id,
      environment: environment(),
      name: input.name,
      institution: input.institution,
      kind: input.kind,
      currency: input.currency
    });
    await recordManualBalance(tx, {
      id,
      currency: input.currency
    }, date, amount);
  });

  return {
    id
  };
}

/** Records a manual account's balance on a date as an opening balance or an adjustment for the difference. */
export async function saveManualValuation(account: {
  id: string;
  currency: string;
}, amount: number, date: string) {
  const db = await database();

  return db.transaction(tx => recordManualBalance(tx, account, date, amount));
}


/** Sets or clears the archive mark; balances, transactions, observations and provider identity remain untouched. */
export async function saveAccountArchived(id: string, archivedAt: string | null) {
  const db = await database();

  const updated = await db.update(accounts).set({
    archived_at: archivedAt
  }).where(and(eq(accounts.id, id), eq(accounts.environment, environment()))).returning({
    id: accounts.id
  });

  return updated.length === 1;
}

/** Changes only the display label; provider identity and financial history remain untouched. */
export async function saveAccountName(id: string, name: string) {
  const db = await database();

  const updated = await db.update(accounts).set({
    name
  }).where(and(eq(accounts.id, id), eq(accounts.environment, environment()))).returning({
    id: accounts.id
  });

  return updated.length === 1;
}

export type ClosingResult = ManualEntryResult | "balance_changed";

class ClosingRefused extends TransactionRollbackError {
  constructor(readonly result: ClosingResult) {
    super();
  }
}

/**
 * Books a manual account's remaining balance away on `date` and archives it in one transaction: as an adjustment, or as a transfer to another active manual account.
 * `expectedBalance` is the balance the user confirmed; a concurrent booking that changed it refuses the closing.
 */
export async function closeAndArchiveManualAccount(account: {
  id: string;
  currency: string;
}, expectedBalance: number, date: string, transferAccountId: string | null, archivedAt: string): Promise<ClosingResult> {
  const db = await database();

  try {
    return await db.transaction(async tx => {
      const total = await tx.select({
        amount: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number)
      }).from(transactions).where(eq(transactions.account_id, account.id)).get();

      if ((total?.amount ?? 0) !== expectedBalance) {
        throw new ClosingRefused("balance_changed");
      }

      const result = await bookManualEntry(tx, randomUUID(), {
        accountId: account.id,
        currency: account.currency,
        date,
        amount: -expectedBalance,
        counterparty: "",
        description: "Account closed",
        categoryId: null,
        categorySource: "manual",
        type: transferAccountId ? "transfer" : "adjustment",
        target: transferAccountId ? {
          accountId: transferAccountId
        } : undefined
      });

      if (result !== "saved") {
        throw new ClosingRefused(result);
      }

      await tx.update(accounts).set({
        archived_at: archivedAt
      }).where(and(eq(accounts.id, account.id), isNull(accounts.archived_at)));

      return "saved" as const;
    });
  } catch (error) {
    if (error instanceof ClosingRefused) {
      return error.result;
    }

    throw error;
  }
}
