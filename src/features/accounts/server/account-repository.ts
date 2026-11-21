import { randomUUID } from "node:crypto";
import { and, eq, inArray, desc, isNotNull, isNull, ne, sql, TransactionRollbackError } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { accountIdentifiers, accounts, balanceSnapshots, categorizationRules, transactions } from "@/server/database/schema";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/lib/booking-references";
// eslint-disable-next-line boundaries/dependencies -- known violation tracked in daberni/ufer#285
import { bookManualEntry, recordManualBalance, type ManualEntryResult } from "@/features/transactions/server/manual-transaction-repository";
import type { AccountKind } from "../account-kinds";
import type { ManualAccountInput } from "./account-schema";
import { assertWritableAccount } from "./writable-account";
import { comparableBankBalanceTypes } from "./account-queries";

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

/**
 * Books an adjustment so a bank-linked account's calculated balance matches the newest booked balance its bank reported, at that balance's date.
 * Returns false when the newest report is not a booked balance; a matching balance books nothing.
 */
export async function reconcileWithReportedBalance(account: {
  id: string;
  currency: string;
}) {
  const db = await database();

  return db.transaction(async tx => {
    await assertWritableAccount(tx, account.id);
    // A concurrent conversion may have made it a manual account, whose bank snapshots no longer count.
    const linked = await tx.select({
      id: accounts.id
    }).from(accounts).where(and(eq(accounts.id, account.id), ne(accounts.provider, "manual"))).get();

    if (!linked) {
      return false;
    }

    const reported = await tx.select({
      date: balanceSnapshots.observed_at,
      amount: balanceSnapshots.amount_minor,
      type: balanceSnapshots.bank_balance_type
    }).from(balanceSnapshots).where(and(eq(balanceSnapshots.account_id, account.id), eq(balanceSnapshots.source, "sync"))).orderBy(desc(balanceSnapshots.observed_at)).get();

    if (!reported?.type || !comparableBankBalanceTypes.includes(reported.type)) {
      return false;
    }

    // The report may already contain bookings dated after it, as the shown difference allows; then nothing is off.
    const total = await tx.select({
      amount: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number)
    }).from(transactions).where(and(eq(transactions.account_id, account.id), isNull(transactions.suppressed_at))).get();

    if (total?.amount !== reported.amount) {
      await recordManualBalance(tx, account, reported.date, reported.amount);
    }

    return true;
  });
}

// The current balance in one statement with the update, as listed: the sum of visible (not hidden) bookings, 0 without any.
const currentBalance = sql`COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=accounts.id AND t.suppressed_at IS NULL),0)`;

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
        latest: sql<string | null>`MAX(${transactions.date})`
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
      id: accounts.id
    }).from(accounts).where(detached).get();

    if (!account) {
      return false;
    }

    // The balance is already the sum of the bookings, including the opening balance its first sync booked; reported bank balances stay as history.
    await tx.delete(accountIdentifiers).where(eq(accountIdentifiers.account_id, id));
    await tx.update(accounts).set({
      provider: "manual",
      provider_uid: null,
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
export async function deleteUnlinkedAccount(id: string, confirmedName: string) {
  const db = await database();

  return db.transaction(async tx => {
    const unlinked = and(eq(accounts.id, id), eq(accounts.name, confirmedName), isNull(accounts.requisition_id));
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
