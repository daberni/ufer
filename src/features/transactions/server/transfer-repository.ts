import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, transactions } from "@/server/database/schema";
import { derivedTransactionType, manualAccountTypes, type TransactionType } from "@/features/transactions/transaction-types";
import type { TransferBooking, TransferOptions } from "@/features/transactions/types";
import { automaticPairingDays, manualLinkDays, unambiguousPairs, type PairingCandidate } from "./transfer-pairing";

type Executor = Database | DatabaseTransaction;

/** Counterparts created on a manual account carry the source booking's id in this reference; unlinking removes them again. */
const createdCounterpartPrefix = "transfer:";

// Bookings automatic pairing may link: unlinked, never linked or unlinked by a person, and either a transfer or a type nobody corrected.
function pairable(alias: string) {
  return sql.raw(`${alias}.transfer_id IS NULL AND ${alias}.transfer_source='auto' AND ${alias}.amount_minor<>0 AND (${alias}.type='transfer' OR (${alias}.type_source='auto' AND ${alias}.type IN ('income','expense')))`);
}

function windowStart(days: number) {
  return `-${days} days`;
}

function windowEnd(days: number) {
  return `+${days} days`;
}

/**
 * Links the bookings of transfers between own accounts that match unambiguously: opposite amounts in the same currency on two accounts of this environment, at most three days apart, with at least one side already a transfer.
 * Bookings with more than one candidate stay unpaired. `accountIds` limits both sides to those accounts, so bookings outside them are neither linked nor counted as candidates. Returns the number of transfers linked.
 */
export async function pairTransfers(executor: Executor, bankingEnvironment: string, accountIds?: string[]) {
  const scopedIds = accountIds ? sql.join(accountIds.map(id => sql`${id}`), sql`,`) : null;
  const withinAccounts = scopedIds ? sql`AND anchor.account_id IN (${scopedIds}) AND other.account_id IN (${scopedIds})` : sql``;

  // The anchor is a transfer; a transfer on the other side is reported once, from its outgoing booking.
  const rows = await executor.all<{
    anchor_id: string;
    anchor_amount: number;
    other_id: string;
  }>(sql`
    SELECT anchor.id AS anchor_id,anchor.amount_minor AS anchor_amount,other.id AS other_id
    FROM transactions anchor
    JOIN accounts anchor_account ON anchor_account.id=anchor.account_id
    JOIN transactions other ON other.booking_date BETWEEN date(anchor.booking_date,${windowStart(automaticPairingDays)}) AND date(anchor.booking_date,${windowEnd(automaticPairingDays)})
      AND other.amount_minor=-anchor.amount_minor
      AND other.currency=anchor.currency
      AND other.account_id<>anchor.account_id
    JOIN accounts other_account ON other_account.id=other.account_id
    WHERE anchor_account.environment=${bankingEnvironment}
    AND other_account.environment=${bankingEnvironment}
    AND anchor.type='transfer'
    AND ${pairable("anchor")}
    AND ${pairable("other")}
    AND (other.type<>'transfer' OR anchor.amount_minor<0)
    ${withinAccounts}
  `);
  const candidates: PairingCandidate[] = rows.map(row => Number(row.anchor_amount) < 0 ? {
    outgoingId: String(row.anchor_id),
    incomingId: String(row.other_id)
  } : {
    outgoingId: String(row.other_id),
    incomingId: String(row.anchor_id)
  });
  const pairs = unambiguousPairs(candidates);

  // Bound statement parameters for both local SQLite and remote libSQL deployments.
  for (let offset = 0; offset < pairs.length; offset += 50) {
    const chunk = pairs.slice(offset, offset + 50).map(pair => ({
      ...pair,
      transferId: randomUUID()
    }));
    const cases = chunk.flatMap(pair => [sql`WHEN ${pair.outgoingId} THEN ${pair.transferId}`, sql`WHEN ${pair.incomingId} THEN ${pair.transferId}`]);
    const ids = chunk.flatMap(pair => [pair.outgoingId, pair.incomingId]);

    await executor.run(sql`UPDATE transactions SET type='transfer',transfer_id=CASE id ${sql.join(cases, sql` `)} END WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`);
  }

  return pairs.length;
}

/** Pairs transfers across this environment in one transaction, for example after a sync has stored every account. */
export async function pairTransfersInEnvironment(bankingEnvironment: string) {
  const db = await database();

  return db.transaction(tx => pairTransfers(tx, bankingEnvironment));
}

const subjectColumns = {
  id: transactions.id,
  account_id: transactions.account_id,
  account_name: accounts.name,
  account_provider: accounts.provider,
  provider_reference: transactions.provider_reference,
  booking_date: transactions.booking_date,
  amount_minor: transactions.amount_minor,
  currency: transactions.currency,
  counterparty: transactions.counterparty,
  description: transactions.description,
  category_id: transactions.category_id,
  type: transactions.type,
  transfer_id: transactions.transfer_id
};

type Subject = NonNullable<Awaited<ReturnType<typeof findSubject>>>;

/** Bookings a person can link with `subject`: unlinked, the exact opposite amount in the same currency, on another account of this environment, within the manual link window. The dialog offers only these and linking accepts only these. */
function linkCandidate(subject: Subject) {
  const inWindow = sql`${transactions.booking_date} BETWEEN date(${subject.booking_date},${windowStart(manualLinkDays)}) AND date(${subject.booking_date},${windowEnd(manualLinkDays)})`;

  return and(eq(accounts.environment, environment()), ne(transactions.account_id, subject.account_id), eq(transactions.amount_minor, -subject.amount_minor), eq(transactions.currency, subject.currency), sql`${transactions.transfer_id} IS NULL`, sql`${transactions.amount_minor}<>0`, inWindow);
}

async function findSubject(executor: Executor, id: string) {
  return executor.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.id, id), eq(accounts.environment, environment()))).get();
}

async function findCounterpart(executor: Executor, subject: Subject) {
  if (!subject.transfer_id) {
    return undefined;
  }

  return executor.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.transfer_id, subject.transfer_id), ne(transactions.id, subject.id))).get();
}

function createdCounterpart(booking: Subject) {
  return booking.provider_reference.startsWith(createdCounterpartPrefix);
}

/**
 * Ends a link. A counterpart Ufer created on a manual account is removed with it; any other counterpart keeps its booking and becomes a transfer without a counterpart, or, with `counterpartType`, takes that type.
 * Both sides are marked as manually unlinked, so automatic pairing and resync leave them alone.
 */
async function dissolveLink(tx: DatabaseTransaction, subject: Subject, counterpartType?: (booking: Subject) => TransactionType) {
  const counterpart = await findCounterpart(tx, subject);

  await tx.update(transactions).set({
    transfer_id: null,
    transfer_source: "manual",
    type_source: "manual"
  }).where(eq(transactions.id, subject.id));

  if (!counterpart) {
    return;
  }

  if (createdCounterpart(counterpart)) {
    await tx.delete(transactions).where(eq(transactions.id, counterpart.id));

    return;
  }

  await tx.update(transactions).set({
    type: counterpartType ? counterpartType(counterpart) : "transfer",
    type_source: "manual",
    transfer_id: null,
    transfer_source: "manual"
  }).where(eq(transactions.id, counterpart.id));
}

/** Where a transfer goes: an existing booking on another own account, a manual account on which the counterpart is created, or no counterpart (an account not tracked in Ufer). */
export type TransferTarget = {
  counterpartId: string;
} | {
  accountId: string;
} | null;

export type TypeChangeResult = "saved" | "not_found" | "manual_account_only" | "counterpart_not_found" | "same_account" | "not_a_candidate" | "account_not_found" | "currency_mismatch" | "zero_amount";

async function link(tx: DatabaseTransaction, ids: string[]) {
  await tx.update(transactions).set({
    type: "transfer",
    type_source: "manual",
    transfer_id: randomUUID(),
    transfer_source: "manual"
  }).where(inArray(transactions.id, ids));
}

async function markManualType(tx: DatabaseTransaction, id: string, type: TransactionType) {
  await tx.update(transactions).set({
    type,
    type_source: "manual"
  }).where(eq(transactions.id, id));
}

async function findManualTarget(tx: DatabaseTransaction, accountId: string) {
  return tx.select({
    id: accounts.id,
    currency: accounts.currency
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.environment, environment()), eq(accounts.provider, "manual"))).get();
}

/** Creates the counterpart of `subject` on a manual account and links both; the created booking carries its source's id in its reference. */
async function createCounterpart(tx: DatabaseTransaction, subject: Subject, accountId: string) {
  const counterpartId = randomUUID();

  await tx.insert(transactions).values({
    id: counterpartId,
    account_id: accountId,
    provider_reference: `${createdCounterpartPrefix}${subject.id}`,
    booking_date: subject.booking_date,
    amount_minor: -subject.amount_minor,
    currency: subject.currency,
    counterparty: subject.account_name,
    description: subject.description || subject.counterparty,
    category_id: subject.category_id,
    category_source: "manual",
    type: "transfer",
    type_source: "manual"
  });
  await link(tx, [subject.id, counterpartId]);
}

/** Leaves the transfer type. A booking Ufer created on a manual account exists only for its link and is removed, its source becoming income or expense; otherwise the pair is corrected together and the counterpart becomes income or expense by its direction. */
async function leaveTransfer(tx: DatabaseTransaction, subject: Subject, counterpart: Subject | undefined, type: TransactionType) {
  if (counterpart && createdCounterpart(subject)) {
    await dissolveLink(tx, counterpart);
    await markManualType(tx, counterpart.id, derivedTransactionType(counterpart.amount_minor));

    return;
  }

  if (subject.transfer_id) {
    await dissolveLink(tx, subject, booking => derivedTransactionType(booking.amount_minor));
  }

  await markManualType(tx, subject.id, type);
}

async function linkExisting(tx: DatabaseTransaction, subject: Subject, counterpart: Subject | undefined, counterpartId: string): Promise<TypeChangeResult> {
  if (counterpart?.id === counterpartId) {
    await markManualType(tx, subject.id, "transfer");

    return "saved";
  }

  const chosen = await findSubject(tx, counterpartId);

  if (!chosen) {
    return "counterpart_not_found";
  }

  if (chosen.account_id === subject.account_id) {
    return "same_account";
  }

  const candidate = await tx.select({
    id: transactions.id
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.id, chosen.id), linkCandidate(subject))).get();

  if (!candidate) {
    return "not_a_candidate";
  }

  if (subject.transfer_id) {
    await dissolveLink(tx, subject);
  }

  await link(tx, [subject.id, chosen.id]);

  return "saved";
}

async function linkManualAccount(tx: DatabaseTransaction, subject: Subject, counterpart: Subject | undefined, accountId: string): Promise<TypeChangeResult> {
  if (counterpart && createdCounterpart(counterpart) && counterpart.account_id === accountId) {
    await markManualType(tx, subject.id, "transfer");

    return "saved";
  }

  const account = await findManualTarget(tx, accountId);

  if (!account) {
    return "account_not_found";
  }

  if (account.id === subject.account_id) {
    return "same_account";
  }

  if (account.currency !== subject.currency) {
    return "currency_mismatch";
  }

  if (subject.amount_minor === 0) {
    return "zero_amount";
  }

  if (subject.transfer_id) {
    await dissolveLink(tx, subject);
  }

  await createCounterpart(tx, subject, account.id);

  return "saved";
}

/** A transfer without a counterpart. Ending an existing link is a manual unlink; a booking Ufer created on a manual account is removed with it. Without a previous link, the booking is paired automatically when exactly one counterpart matches. */
async function transferWithoutCounterpart(tx: DatabaseTransaction, subject: Subject, counterpart: Subject | undefined) {
  if (!subject.transfer_id) {
    await markManualType(tx, subject.id, "transfer");
    await pairTransfers(tx, environment());

    return;
  }

  if (counterpart && createdCounterpart(subject)) {
    await dissolveLink(tx, counterpart);

    return;
  }

  await dissolveLink(tx, subject);
  await markManualType(tx, subject.id, "transfer");
}

/**
 * Stores a manually chosen type and, for a transfer, its target in one transaction. `target` undefined keeps a transfer's current link; null means no counterpart.
 * A target booking must be one of the subject's link candidates, and a target manual account must use the subject's currency. Every check runs before anything is written.
 */
export async function saveTransactionType(id: string, type: TransactionType, target?: TransferTarget): Promise<TypeChangeResult> {
  const db = await database();

  return db.transaction(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    if (manualAccountTypes.includes(type) && subject.account_provider !== "manual") {
      return "manual_account_only";
    }

    const counterpart = await findCounterpart(tx, subject);

    if (type !== "transfer") {
      await leaveTransfer(tx, subject, counterpart, type);

      return "saved";
    }

    if (target && "counterpartId" in target) {
      return linkExisting(tx, subject, counterpart, target.counterpartId);
    }

    if (target && "accountId" in target) {
      return linkManualAccount(tx, subject, counterpart, target.accountId);
    }

    if (target === undefined && subject.transfer_id) {
      await markManualType(tx, subject.id, "transfer");

      return "saved";
    }

    await transferWithoutCounterpart(tx, subject, counterpart);

    return "saved";
  });
}

/** Creates the counterpart of the booking `sourceReference` on `accountId` and links both, as a person does in the edit dialog; for seeding data. */
export async function createTransferCounterpart(tx: DatabaseTransaction, sourceAccountId: string, sourceReference: string, accountId: string) {
  const source = await tx.select({
    id: transactions.id
  }).from(transactions).where(and(eq(transactions.account_id, sourceAccountId), eq(transactions.provider_reference, sourceReference))).get();
  const subject = source ? await findSubject(tx, source.id) : undefined;

  if (!subject) {
    throw new Error("The source booking of a created counterpart is missing.");
  }

  await createCounterpart(tx, subject, accountId);
}

function transferBooking(booking: Subject): TransferBooking {
  return {
    id: booking.id,
    account_id: booking.account_id,
    account_name: booking.account_name,
    booking_date: booking.booking_date,
    amount_minor: booking.amount_minor,
    currency: booking.currency,
    counterparty: booking.counterparty,
    description: booking.description,
    created: createdCounterpart(booking)
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

  const distance = sql`abs(julianday(${transactions.booking_date})-julianday(${subject.booking_date}))`;
  const candidates = await db.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(linkCandidate(subject)).orderBy(distance, asc(transactions.booking_date), asc(transactions.id)).limit(20);
  const manualAccounts = subject.amount_minor === 0 ? [] : await db.select({
    id: accounts.id,
    name: accounts.name
  }).from(accounts).where(and(eq(accounts.environment, environment()), eq(accounts.provider, "manual"), eq(accounts.currency, subject.currency), ne(accounts.id, subject.account_id))).orderBy(asc(accounts.name));

  return {
    counterpart: counterpart ? transferBooking(counterpart) : null,
    candidates: candidates.map(transferBooking),
    accounts: manualAccounts
  };
}
