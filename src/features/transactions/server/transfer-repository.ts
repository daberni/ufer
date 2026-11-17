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

export type TypeChangeResult = "saved" | "not_found" | "manual_account_only";

/**
 * Stores a manually chosen type. Leaving the transfer type corrects the linked pair together: the link ends and the counterpart becomes income or expense by its direction. Choosing the transfer type pairs the booking automatically when exactly one counterpart matches.
 */
export async function saveTransactionType(id: string, type: TransactionType): Promise<TypeChangeResult> {
  const db = await database();

  return db.transaction(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    if (manualAccountTypes.includes(type) && subject.account_provider !== "manual") {
      return "manual_account_only";
    }

    const counterpart = subject.transfer_id && type !== "transfer" ? await findCounterpart(tx, subject) : undefined;

    // A booking Ufer created on a manual account exists only for its link: leaving the transfer type removes it and makes its source income or expense.
    if (counterpart && createdCounterpart(subject)) {
      await dissolveLink(tx, counterpart);
      await tx.update(transactions).set({
        type: derivedTransactionType(counterpart.amount_minor),
        type_source: "manual"
      }).where(eq(transactions.id, counterpart.id));

      return "saved";
    }

    if (subject.transfer_id && type !== "transfer") {
      await dissolveLink(tx, subject, booking => derivedTransactionType(booking.amount_minor));
    }

    await tx.update(transactions).set({
      type,
      type_source: "manual"
    }).where(eq(transactions.id, subject.id));

    if (type === "transfer" && !subject.transfer_id) {
      await pairTransfers(tx, environment());
    }

    return "saved";
  });
}

export type LinkResult = "saved" | "not_found" | "counterpart_not_found" | "same_account" | "already_linked" | "not_a_candidate";

async function link(tx: DatabaseTransaction, ids: string[]) {
  await tx.update(transactions).set({
    type: "transfer",
    type_source: "manual",
    transfer_id: randomUUID(),
    transfer_source: "manual"
  }).where(inArray(transactions.id, ids));
}

/** Links two existing bookings as the outgoing and incoming side of one transfer when the counterpart is one of the subject's link candidates. */
export async function saveTransferLink(id: string, counterpartId: string): Promise<LinkResult> {
  const db = await database();

  return db.transaction(async tx => {
    const subject = await findSubject(tx, id);
    const counterpart = await findSubject(tx, counterpartId);

    if (!subject) {
      return "not_found";
    }

    if (!counterpart) {
      return "counterpart_not_found";
    }

    if (subject.account_id === counterpart.account_id) {
      return "same_account";
    }

    if (subject.transfer_id || counterpart.transfer_id) {
      return "already_linked";
    }

    const candidate = await tx.select({
      id: transactions.id
    }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.id, counterpart.id), linkCandidate(subject))).get();

    if (!candidate) {
      return "not_a_candidate";
    }

    await link(tx, [subject.id, counterpart.id]);

    return "saved";
  });
}

export type ManualCounterpartResult = "saved" | "not_found" | "account_not_found" | "same_account" | "currency_mismatch" | "zero_amount" | "already_linked";

/** Marks a booking as a transfer to or from a manual account and creates the counterpart booking there, so the movement is entered once. */
export async function saveTransferToManualAccount(id: string, accountId: string): Promise<ManualCounterpartResult> {
  const db = await database();

  return db.transaction(async tx => {
    const subject = await findSubject(tx, id);
    const account = await tx.select({
      id: accounts.id,
      currency: accounts.currency
    }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.environment, environment()), eq(accounts.provider, "manual"))).get();

    if (!subject) {
      return "not_found";
    }

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
      return "already_linked";
    }

    const counterpartId = randomUUID();

    await tx.insert(transactions).values({
      id: counterpartId,
      account_id: account.id,
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

    return "saved";
  });
}

export type UnlinkResult = "saved" | "not_found" | "not_linked";

/** Ends a transfer link; both bookings stay transfers without a counterpart unless one was created on a manual account, which is removed. */
export async function removeTransferLink(id: string): Promise<UnlinkResult> {
  const db = await database();

  return db.transaction(async tx => {
    const subject = await findSubject(tx, id);

    if (!subject) {
      return "not_found";
    }

    if (!subject.transfer_id) {
      return "not_linked";
    }

    const counterpart = await findCounterpart(tx, subject);

    // Unlinking from the created side removes the created booking and keeps its source.
    if (counterpart && createdCounterpart(subject)) {
      await dissolveLink(tx, counterpart);

      return "saved";
    }

    await dissolveLink(tx, subject);

    return "saved";
  });
}

function transferBooking(booking: Subject): TransferBooking {
  return {
    id: booking.id,
    account_name: booking.account_name,
    booking_date: booking.booking_date,
    amount_minor: booking.amount_minor,
    currency: booking.currency,
    counterparty: booking.counterparty,
    description: booking.description
  };
}

/** The current counterpart of a booking, or, while it has none, the bookings and manual accounts it can be linked with. Undefined for an unknown booking. */
export async function readTransferOptions(id: string): Promise<TransferOptions | undefined> {
  const db = await database();
  const subject = await findSubject(db, id);

  if (!subject) {
    return undefined;
  }

  const counterpart = await findCounterpart(db, subject);

  if (subject.transfer_id) {
    return {
      counterpart: counterpart ? transferBooking(counterpart) : null,
      candidates: [],
      accounts: []
    };
  }

  const distance = sql`abs(julianday(${transactions.booking_date})-julianday(${subject.booking_date}))`;
  const candidates = await db.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(linkCandidate(subject)).orderBy(distance, asc(transactions.booking_date), asc(transactions.id)).limit(20);
  const manualAccounts = subject.amount_minor === 0 ? [] : await db.select({
    id: accounts.id,
    name: accounts.name
  }).from(accounts).where(and(eq(accounts.environment, environment()), eq(accounts.provider, "manual"), eq(accounts.currency, subject.currency), ne(accounts.id, subject.account_id))).orderBy(asc(accounts.name));

  return {
    counterpart: null,
    candidates: candidates.map(transferBooking),
    accounts: manualAccounts
  };
}
