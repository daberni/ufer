import { and, eq, inArray, desc, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { bookableAccount } from "@/features/transactions/server/booking-accounts";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { withRefusableTransaction, withTransaction } from "@/server/database/transaction";
import { accountIdentifiers, accounts, balanceSnapshots, categorizationRules, securityTrades, transactions } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/lib/booking-references";
import type { AccountKind } from "../account-kinds";
import type { ManualAccountInput } from "./account-schema";

export async function findManualAccount(id: string) {
  const db = await database();
  const scope = and(eq(accounts.id, id), eq(accounts.provider, "manual"), bookableAccount);

  return db.select().from(accounts).where(scope).get();
}

/** Runs an account use case in one write transaction; account and booking reads and writes take the provided transaction. */
export async function withAccountTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>) {
  return withTransaction(work);
}

/** Runs an account use case like `withAccountTransaction`; a `refuse(result)` inside rolls it back and resolves to that result. */
export async function withRefusableAccountTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>) {
  return withRefusableTransaction(work);
}

export { refuse } from "@/server/database/transaction";

/** Inserts a manual account inside the caller's write transaction, which also books its opening balance. */
export async function insertManualAccount(tx: DatabaseTransaction, id: string, input: ManualAccountInput) {
  await tx.insert(accounts).values({
    id,
    name: input.name,
    kind: input.kind,
    currency: input.currency
  });
}

/** The sum and latest date of an account's visible bookings, read inside the caller's write transaction. */
export async function readBookedTotal(tx: DatabaseTransaction, accountId: string) {
  const total = await tx.select({
    amount: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number),
    latest: sql<string | null>`MAX(${transactions.date})`
  }).from(transactions).where(and(eq(transactions.account_id, accountId), isNull(transactions.suppressed_at))).get();

  return {
    amount: total?.amount ?? 0,
    latest: total?.latest ?? null
  };
}

/** The newest balance a bank-linked account's sync reported, read inside the caller's write transaction; null when the account is no longer bank-linked. */
export async function readLatestReportedBalance(tx: DatabaseTransaction, accountId: string) {
  // A concurrent conversion may have made it a manual account, whose bank snapshots no longer count.
  const linked = await tx.select({
    id: accounts.id
  }).from(accounts).where(and(eq(accounts.id, accountId), ne(accounts.provider, "manual"))).get();

  if (!linked) {
    return null;
  }

  const reported = await tx.select({
    date: balanceSnapshots.observed_at,
    amount: balanceSnapshots.amount_minor,
    type: balanceSnapshots.bank_balance_type
  }).from(balanceSnapshots).where(and(eq(balanceSnapshots.account_id, accountId), eq(balanceSnapshots.source, "sync"))).orderBy(desc(balanceSnapshots.observed_at)).get();

  return reported ?? null;
}

// The current balance in one statement with the update, as listed: the sum of visible (not hidden) bookings, 0 without any.
const currentBalance = sql`COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=accounts.id AND t.suppressed_at IS NULL),0)`;

/** Archives an active account only if its balance is exactly 0 at the moment of the update; returns whether it was archived. */
export async function archiveSettledAccount(id: string, archivedAt: string) {
  const db = await database();

  return archiveIfSettled(db, id, archivedAt);
}

/** Archives an active account only if its balance is exactly 0 at the moment of the update, inside the caller's transaction when given one; returns whether it was archived. */
export async function archiveIfSettled(executor: Pick<Database, "update">, id: string, archivedAt: string) {
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
  }).where(and(eq(accounts.id, id), eq(accounts.provider, "manual"), bookableAccount, isNull(accounts.archived_at), fitsBalance)).returning({
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

    const trade = await tx.select({
      id: securityTrades.id
    }).from(securityTrades).where(eq(securityTrades.account_id, id)).get();

    if (trade) {
      throw new HttpError(409, "This brokerage account still has trades. Delete its trades first.");
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
