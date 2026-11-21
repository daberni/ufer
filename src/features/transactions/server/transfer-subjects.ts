import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import type { TransferBooking, TransferOptions } from "@/features/transactions/types";
import { createdCounterpart, enteredInUfer, linkCandidate, touchesArchived } from "./transfer-rules";

type Executor = Database | DatabaseTransaction;

export const subjectColumns = {
  id: transactions.id,
  account_id: transactions.account_id,
  account_name: accounts.name,
  account_provider: accounts.provider,
  account_archived_at: accounts.archived_at,
  provider_reference: transactions.provider_reference,
  date: transactions.date,
  amount_minor: transactions.amount_minor,
  currency: transactions.currency,
  counterparty: transactions.counterparty,
  description: transactions.description,
  category_id: transactions.category_id,
  type: transactions.type,
  transfer_id: transactions.transfer_id
};

export type Subject = NonNullable<Awaited<ReturnType<typeof findSubject>>>;

export async function findSubject(executor: Executor, id: string) {
  return executor.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(transactions.id, id)).get();
}

export async function findCounterpart(executor: Executor, subject: Subject) {
  if (!subject.transfer_id) {
    return undefined;
  }

  return executor.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.transfer_id, subject.transfer_id), ne(transactions.id, subject.id))).get();
}

export async function touchesArchivedAccount(executor: Executor, subject: Subject) {
  if (subject.account_archived_at !== null) {
    return true;
  }

  return touchesArchived(subject, await findCounterpart(executor, subject));
}

/** The booking `counterpartId` if it is one of `subject`'s link candidates. */
export async function findLinkCandidate(tx: DatabaseTransaction, subject: Subject, counterpartId: string) {
  return tx.select({
    id: transactions.id
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.id, counterpartId), linkCandidate(subject))).get();
}

/** An active manual account a counterpart can be created on or moved to. */
export async function findManualTarget(tx: DatabaseTransaction, accountId: string) {
  return tx.select({
    id: accounts.id,
    name: accounts.name,
    currency: accounts.currency
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.provider, "manual"), isNull(accounts.archived_at))).get();
}

function transferBooking(booking: Subject): TransferBooking {
  return {
    id: booking.id,
    account_id: booking.account_id,
    account_name: booking.account_name,
    date: booking.date,
    amount_minor: booking.amount_minor,
    currency: booking.currency,
    counterparty: booking.counterparty,
    description: booking.description,
    created: createdCounterpart(booking),
    entered: enteredInUfer(booking)
  };
}

/** A booking's current counterpart, the bookings it can be linked with and the manual accounts a counterpart can be created on. Undefined for an unknown booking. */
export async function readTransferOptions(id: string): Promise<TransferOptions | undefined> {
  const db = await database();
  const subject = await findSubject(db, id);

  if (!subject) {
    return undefined;
  }

  const counterpart = await findCounterpart(db, subject);

  const distance = sql`abs(julianday(${transactions.date})-julianday(${subject.date}))`;
  const candidates = await db.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(linkCandidate(subject)).orderBy(distance, asc(transactions.date), asc(transactions.id)).limit(20);
  const manualAccounts = subject.amount_minor === 0 ? [] : await db.select({
    id: accounts.id,
    name: accounts.name
  }).from(accounts).where(and(eq(accounts.provider, "manual"), isNull(accounts.archived_at), eq(accounts.currency, subject.currency), ne(accounts.id, subject.account_id))).orderBy(asc(accounts.name));

  return {
    counterpart: counterpart ? transferBooking(counterpart) : null,
    candidates: candidates.map(transferBooking),
    accounts: manualAccounts
  };
}
