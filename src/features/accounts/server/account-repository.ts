import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne, sql, TransactionRollbackError } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { accountIdentifiers, accounts, balanceSnapshots, categorizationRules, transactions } from "@/server/database/schema";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/features/transactions/server/transfer-repository";
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
export async function archiveSettledAccount(id: string, archivedAt: string) {
  const db = await database();

  return archiveIfSettled(db, id, archivedAt);
}

async function archiveIfSettled(executor: Pick<Database, "update">, id: string, archivedAt: string) {
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
      if (!await archiveIfSettled(tx, account.id, archivedAt)) {
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

/**
 * Turns a bank account whose connection was removed into a manual account in one transaction. The last bank balance stays the account's balance through an opening balance, or an adjustment on the later of its date and the latest booking.
 * The bank identity is dropped, so a later connection to the same bank creates a new account instead of syncing into a manual one. Returns whether the account was converted.
 */
export async function convertDetachedAccount(id: string) {
  const db = await database();

  return db.transaction(async tx => {
    const detached = and(eq(accounts.id, id), eq(accounts.provider, "enable_banking"), isNull(accounts.requisition_id));
    const account = await tx.select({
      id: accounts.id,
      currency: accounts.currency,
      balance_minor: accounts.balance_minor,
      balance_date: accounts.balance_date
    }).from(accounts).where(detached).get();

    if (!account) {
      return false;
    }

    // The balance history keeps the last bank balance as an observation, as it showed it while the account was synced.
    if (account.balance_minor !== null && account.balance_date !== null) {
      // A manual balance is the sum of all bookings, so the difference is booked no earlier than the latest booking; bookings after the bank balance date would otherwise change it.
      const latest = await tx.select({
        date: sql<string | null>`MAX(${transactions.booking_date})`
      }).from(transactions).where(and(eq(transactions.account_id, id), isNull(transactions.suppressed_at))).get();
      const correctionDate = latest?.date && latest.date > account.balance_date ? latest.date : account.balance_date;

      await recordManualBalance(tx, account, correctionDate, account.balance_minor);
      await tx.insert(balanceSnapshots).values({
        id: randomUUID(),
        account_id: id,
        observed_at: account.balance_date,
        amount_minor: account.balance_minor,
        source: "sync"
      }).onConflictDoNothing();

      // The correction after later bookings is the balance on that date too; the history anchors there instead of adding it on top of the earlier bank balance.
      if (correctionDate !== account.balance_date) {
        await tx.insert(balanceSnapshots).values({
          id: randomUUID(),
          account_id: id,
          observed_at: correctionDate,
          amount_minor: account.balance_minor,
          source: "manual"
        }).onConflictDoUpdate({
          target: [balanceSnapshots.account_id, balanceSnapshots.observed_at],
          set: {
            amount_minor: account.balance_minor,
            source: "manual"
          }
        });
      }
    }

    await tx.delete(accountIdentifiers).where(eq(accountIdentifiers.account_id, id));
    await tx.update(accounts).set({
      provider: "manual",
      provider_uid: null,
      balance_minor: null,
      balance_date: null,
      last_synced_at: null,
      sync_error: null
    }).where(detached);

    return true;
  });
}

const removedAccountPrefix = "removed:";

/**
 * Deletes an account that is not linked to a bank connection, with its bookings, their splits, balance observations and bank identifiers, in one transaction.
 * A linked booking on another account stays with its amount as a transfer without a counterpart; one Ufer created for a deleted booking becomes an ordinary manual entry.
 * Rules and automatic types that named the account as transfer target keep their transfer type with a target that matches no account, so pairing never links them. Returns whether the account was deleted.
 */
export async function deleteUnlinkedAccount(id: string) {
  const db = await database();

  return db.transaction(async tx => {
    const unlinked = and(eq(accounts.id, id), isNull(accounts.requisition_id));
    const account = await tx.select({
      id: accounts.id
    }).from(accounts).where(unlinked).get();

    if (!account) {
      return false;
    }

    const own = tx.select({
      transfer_id: transactions.transfer_id
    }).from(transactions).where(and(eq(transactions.account_id, id), isNotNull(transactions.transfer_id)));
    const counterparts = await tx.select({
      id: transactions.id,
      provider_reference: transactions.provider_reference
    }).from(transactions).where(and(ne(transactions.account_id, id), inArray(transactions.transfer_id, own)));

    for (const counterpart of counterparts) {
      const created = counterpart.provider_reference.startsWith(createdCounterpartPrefix);

      await tx.update(transactions).set({
        provider_reference: created ? `${manualEntryPrefix}${counterpart.id}` : counterpart.provider_reference,
        transfer_id: null,
        transfer_source: "manual",
        type_source: "manual",
        type_rule_id: null,
        type_transfer_account_id: null
      }).where(eq(transactions.id, counterpart.id));
    }

    // A target that resolves to no account keeps these bookings and rules from pairing with any account; no target would allow every account.
    const removedTarget = `${removedAccountPrefix}${id}`;

    await tx.update(transactions).set({
      type_transfer_account_id: removedTarget
    }).where(eq(transactions.type_transfer_account_id, id));
    await tx.update(categorizationRules).set({
      transfer_account_id: removedTarget
    }).where(eq(categorizationRules.transfer_account_id, id));
    await tx.delete(transactions).where(eq(transactions.account_id, id));
    await tx.delete(balanceSnapshots).where(eq(balanceSnapshots.account_id, id));
    await tx.delete(accountIdentifiers).where(eq(accountIdentifiers.account_id, id));
    await tx.delete(accounts).where(unlinked);

    return true;
  });
}
