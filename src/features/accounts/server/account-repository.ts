import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { bookManualEntry, recordManualBalance, type ManualEntryResult } from "@/features/transactions/server/manual-transaction-repository";
import type { AccountKind } from "../account-kinds";
import type { ManualAccountInput } from "./account-schema";
import { assertWritableAccount } from "./writable-account";

export async function findManualAccount(id: string) {
  const db = await database();
  const scope = and(eq(accounts.id, id), eq(accounts.provider, "manual"));

  return db.select().from(accounts).where(scope).get();
}

/** Whether an own, not archived account with this ID exists. */
export async function activeAccountExists(id: string) {
  const db = await database();
  const found = await db.select({
    id: accounts.id
  }).from(accounts).where(and(eq(accounts.id, id), isNull(accounts.archived_at))).get();

  return found !== undefined;
}

/** Creates a manual account with its starting balance as the opening balance transaction. */
export async function insertManualAccount(input: ManualAccountInput, amount: number, date: string) {
  const db = await database();
  const id = randomUUID();

  await db.transaction(async tx => {
    await tx.insert(accounts).values({
      id,
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

  return db.transaction(async tx => {
    await assertWritableAccount(tx, account.id);

    return recordManualBalance(tx, account, date, amount);
  });
}


// The current balance in one statement with the update, as listed: a manual account's sum of visible (not hidden) bookings (0 without any), otherwise the provider balance, whose NULL (unknown) never equals 0.
const currentBalance = sql`(CASE WHEN ${accounts.provider}='manual' THEN COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=accounts.id AND t.suppressed_at IS NULL),0) ELSE ${accounts.balance_minor} END)`;

/** Archives an active account only if its balance is exactly 0 at the moment of the update; returns whether it was archived. */
export async function archiveSettledAccount(executor: Pick<Database, "update">, id: string, archivedAt: string) {
  const updated = await executor.update(accounts).set({
    archived_at: archivedAt
  }).where(and(eq(accounts.id, id), isNull(accounts.archived_at), sql`${currentBalance}=0`)).returning({
    id: accounts.id
  });

  return updated.length === 1;
}

/** Sets or clears the archive mark; balances, transactions, observations and provider identity remain untouched. */
export async function saveAccountArchived(id: string, archivedAt: string | null) {
  const db = await database();

  const updated = await db.update(accounts).set({
    archived_at: archivedAt
  }).where(eq(accounts.id, id)).returning({
    id: accounts.id
  });

  return updated.length === 1;
}

/**
 * Changes a manual account's type while it is active; a loan additionally requires a balance that is not positive at the moment of the update.
 * Returns whether it was changed, so a concurrent archive or booking refuses the change.
 */
export async function saveAccountKind(id: string, kind: AccountKind) {
  const db = await database();
  const fitsBalance = kind === "loan" ? sql`${currentBalance}<=0` : undefined;

  const updated = await db.update(accounts).set({
    kind
  }).where(and(eq(accounts.id, id), eq(accounts.provider, "manual"), isNull(accounts.archived_at), fitsBalance)).returning({
    id: accounts.id
  });

  return updated.length === 1;
}

/** Changes only the display label; provider identity and financial history remain untouched. */
export async function saveAccountName(id: string, name: string) {
  const db = await database();

  const updated = await db.update(accounts).set({
    name
  }).where(eq(accounts.id, id)).returning({
    id: accounts.id
  });

  return updated.length === 1;
}

export type ClosingResult = ManualEntryResult | "balance_changed";

/** Refuses a closing date before the account's last booking; the service words the refusal for the request. */
export class ClosingBeforeLastBooking extends Error {
  constructor(readonly lastBooking: string) {
    super("The closing date precedes the last booking.");
  }
}

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
        amount: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number),
        latest: sql<string | null>`MAX(${transactions.booking_date})`
      }).from(transactions).where(and(eq(transactions.account_id, account.id), isNull(transactions.suppressed_at))).get();

      if ((total?.amount ?? 0) !== expectedBalance) {
        throw new ClosingRefused("balance_changed");
      }

      // A closing before the last booking would leave activity after the account reached 0.
      if (total?.latest && date < total.latest) {
        throw new ClosingBeforeLastBooking(total.latest);
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
        categoryRuleId: null,
        type: transferAccountId ? "transfer" : "adjustment",
        target: transferAccountId ? {
          accountId: transferAccountId
        } : undefined
      });

      if (result !== "saved") {
        throw new ClosingRefused(result);
      }

      // A concurrent booking leaves a balance other than 0, which refuses the closing and rolls back its booking.
      if (!await archiveSettledAccount(tx, account.id, archivedAt)) {
        throw new ClosingRefused("balance_changed");
      }

      return "saved" as const;
    });
  } catch (error) {
    if (error instanceof ClosingRefused) {
      return error.result;
    }

    throw error;
  }
}
