import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, transactions } from "@/server/database/schema";
import { derivedTransactionType, manualAccountTypes, type TransactionType } from "@/features/transactions/transaction-types";
import type { TransferBooking, TransferOptions } from "@/features/transactions/types";
import type { CategorizedEntry } from "./transaction-entry";
import { automaticPairingDays, manualLinkDays, unambiguousPairs, type PairingCandidate } from "./transfer-pairing";

type Executor = Database | DatabaseTransaction;

/** Counterparts created on a manual account carry the source booking's id in this reference; unlinking removes them again. */
export const createdCounterpartPrefix = "transfer:";

/** Bookings entered in Ufer on a manual account (manual transactions, opening balances and adjustments) carry their own id in this reference. */
export const manualEntryPrefix = "manual:";

// Bookings automatic pairing may link: visible, unlinked, never linked or unlinked by a person, and either a transfer or a type nobody corrected.
function pairable(alias: string) {
  return sql.raw(`${alias}.suppressed_at IS NULL AND ${alias}.transfer_id IS NULL AND ${alias}.transfer_source='auto' AND ${alias}.amount_minor<>0 AND (${alias}.type='transfer' OR (${alias}.type_source='auto' AND ${alias}.type IN ('income','expense')))`);
}

function windowStart(days: number) {
  return `-${days} days`;
}

function windowEnd(days: number) {
  return `+${days} days`;
}

/**
 * Links the bookings of transfers between own accounts that match unambiguously: opposite amounts in the same currency on two accounts of this environment, at most three days apart, with at least one side already a transfer.
 * Bookings with more than one candidate stay unpaired. Returns the number of transfers linked.
 */
export async function pairTransfers(executor: Executor, bankingEnvironment: string) {
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

export type Subject = NonNullable<Awaited<ReturnType<typeof findSubject>>>;

/** Bookings a person can link with `subject`: unlinked, the exact opposite amount in the same currency, on another account of this environment, within the manual link window. The dialog offers only these and linking accepts only these. */
function linkCandidate(subject: Subject) {
  const inWindow = sql`${transactions.booking_date} BETWEEN date(${subject.booking_date},${windowStart(manualLinkDays)}) AND date(${subject.booking_date},${windowEnd(manualLinkDays)})`;

  return and(eq(accounts.environment, environment()), ne(transactions.account_id, subject.account_id), eq(transactions.amount_minor, -subject.amount_minor), eq(transactions.currency, subject.currency), sql`${transactions.transfer_id} IS NULL`, sql`${transactions.suppressed_at} IS NULL`, sql`${transactions.amount_minor}<>0`, inWindow);
}

export async function findSubject(executor: Executor, id: string) {
  return executor.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.id, id), eq(accounts.environment, environment()))).get();
}

export async function findCounterpart(executor: Executor, subject: Subject) {
  if (!subject.transfer_id) {
    return undefined;
  }

  return executor.select(subjectColumns).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.transfer_id, subject.transfer_id), ne(transactions.id, subject.id))).get();
}

function createdCounterpart(booking: Subject) {
  return booking.provider_reference.startsWith(createdCounterpartPrefix);
}

/** Whether a booking was entered in Ufer rather than imported from a bank or a CSV file: a manual entry or a created counterpart on a manual account. */
export function enteredInUfer(booking: Pick<Subject, "account_provider" | "provider_reference">) {
  const reference = booking.provider_reference;

  return booking.account_provider === "manual" && (reference.startsWith(manualEntryPrefix) || reference.startsWith(createdCounterpartPrefix));
}

/**
 * Whether two linked bookings form one movement between manual accounts entered in Ufer. Neither side is the source of truth: either side edits, moves or removes the pair.
 * When one side was imported, the imported booking is the source of truth and the entered side follows it.
 */
export function enteredPair(subject: Subject, counterpart: Subject) {
  return enteredInUfer(subject) && enteredInUfer(counterpart);
}

/** Removes one side of an entered pair. The other side stays as a transfer without a counterpart; if it was created for the removed side, it becomes an ordinary manual entry. */
export async function removeEnteredLeg(tx: DatabaseTransaction, leg: Subject, remaining: Subject) {
  await tx.delete(transactions).where(eq(transactions.id, leg.id));

  const reference = remaining.provider_reference === `${createdCounterpartPrefix}${leg.id}` ? `${manualEntryPrefix}${remaining.id}` : remaining.provider_reference;

  await tx.update(transactions).set({
    provider_reference: reference,
    transfer_id: null,
    transfer_source: "manual"
  }).where(eq(transactions.id, remaining.id));
}

/**
 * Ends a link. A counterpart Ufer created on a manual account is removed with it; any other counterpart keeps its booking and becomes a transfer without a counterpart, or, with `counterpartType`, takes that type.
 * Both sides are marked as manually unlinked, so automatic pairing and resync leave them alone.
 */
export async function dissolveLink(tx: DatabaseTransaction, subject: Subject, counterpartType?: (booking: Subject) => TransactionType) {
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

export type TypeChangeResult = "saved" | "not_found" | "manual_account_only" | "counterpart_not_found" | "same_account" | "not_a_candidate" | "account_not_found" | "currency_mismatch" | "zero_amount" | "created_counterpart";

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
    name: accounts.name,
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

/** The booking `counterpartId` if a person may link it with `subject`, otherwise why not. */
async function checkLinkCandidate(tx: DatabaseTransaction, subject: Subject, counterpartId: string): Promise<TypeChangeResult | Subject> {
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

  return candidate ? chosen : "not_a_candidate";
}

async function linkExisting(tx: DatabaseTransaction, subject: Subject, counterpart: Subject | undefined, counterpartId: string): Promise<TypeChangeResult> {
  if (counterpart?.id === counterpartId) {
    await markManualType(tx, subject.id, "transfer");

    return "saved";
  }

  const chosen = await checkLinkCandidate(tx, subject, counterpartId);

  if (typeof chosen === "string") {
    return chosen;
  }

  if (subject.transfer_id) {
    await dissolveLink(tx, subject);
  }

  await link(tx, [subject.id, chosen.id]);

  return "saved";
}

/** Moves the other side of an entered pair to another manual account, keeping its booking. */
async function moveEnteredLeg(tx: DatabaseTransaction, subject: Subject, counterpart: Subject, accountId: string): Promise<TypeChangeResult> {
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

  await tx.update(transactions).set({
    account_id: account.id
  }).where(eq(transactions.id, counterpart.id));
  await markManualType(tx, subject.id, "transfer");

  return "saved";
}

function keepsEnteredPair(counterpart: Subject, target: TransferTarget | undefined) {
  if (target === undefined) {
    return true;
  }

  if (target === null) {
    return false;
  }

  return "counterpartId" in target ? target.counterpartId === counterpart.id : target.accountId === counterpart.account_id;
}

/** A type or target change on one side of an entered pair; both sides are one movement, so the other side moves or is removed with it. */
async function changeEnteredPair(tx: DatabaseTransaction, subject: Subject, counterpart: Subject, type: TransactionType, target: TransferTarget | undefined): Promise<TypeChangeResult> {
  if (type !== "transfer") {
    await removeEnteredLeg(tx, counterpart, subject);
    await markManualType(tx, subject.id, type);

    return "saved";
  }

  if (keepsEnteredPair(counterpart, target)) {
    await markManualType(tx, subject.id, "transfer");

    return "saved";
  }

  if (target && "accountId" in target) {
    return moveEnteredLeg(tx, subject, counterpart, target.accountId);
  }

  if (target) {
    const chosen = await checkLinkCandidate(tx, subject, target.counterpartId);

    if (typeof chosen === "string") {
      return chosen;
    }

    await removeEnteredLeg(tx, counterpart, subject);
    await link(tx, [subject.id, chosen.id]);

    return "saved";
  }

  await removeEnteredLeg(tx, counterpart, subject);
  await markManualType(tx, subject.id, "transfer");

  return "saved";
}

/** An imported booking fixes the entered leg's date; two entered legs share the subject's date and description and name the other account. */
async function alignTransferPair(tx: DatabaseTransaction, id: string) {
  const subject = await findSubject(tx, id);
  const counterpart = subject ? await findCounterpart(tx, subject) : undefined;

  if (!subject || !counterpart) {
    return;
  }

  if (!enteredPair(subject, counterpart)) {
    const subjectIsEntered = enteredInUfer(subject);
    const entered = subjectIsEntered ? subject : counterpart;
    const imported = subjectIsEntered ? counterpart : subject;

    if (enteredInUfer(entered)) {
      await tx.update(transactions).set({
        booking_date: imported.booking_date
      }).where(eq(transactions.id, entered.id));
    }

    return;
  }

  await tx.update(transactions).set({
    counterparty: counterpart.account_name
  }).where(eq(transactions.id, subject.id));
  await tx.update(transactions).set({
    counterparty: subject.account_name,
    description: subject.description,
    booking_date: subject.booking_date
  }).where(eq(transactions.id, counterpart.id));
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

/**
 * A transfer that a person chose to leave without a counterpart. It is marked as manually unlinked, so automatic pairing never links it, now or on later syncs and imports. Ending an existing link removes a booking Ufer created on a manual account.
 */
async function transferWithoutCounterpart(tx: DatabaseTransaction, subject: Subject, counterpart: Subject | undefined) {
  if (!subject.transfer_id) {
    await tx.update(transactions).set({
      type: "transfer",
      type_source: "manual",
      transfer_source: "manual"
    }).where(eq(transactions.id, subject.id));

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
 * Stores a manually chosen type and, for a transfer, its target inside a caller's transaction. `target` undefined keeps a transfer's current link; null means no counterpart, chosen deliberately.
 * A target booking must be one of the subject's link candidates, and a target manual account must use the subject's currency. A failed check returns before anything is written.
 */
export async function applyTransactionType(tx: DatabaseTransaction, id: string, type: TransactionType, target?: TransferTarget): Promise<TypeChangeResult> {
  const result = await changeType(tx, id, type, target);

  if (result === "saved") {
    await alignTransferPair(tx, id);
  }

  return result;
}

async function changeType(tx: DatabaseTransaction, id: string, type: TransactionType, target?: TransferTarget): Promise<TypeChangeResult> {
  const subject = await findSubject(tx, id);

  if (!subject) {
    return "not_found";
  }

  if (manualAccountTypes.includes(type) && subject.account_provider !== "manual") {
    return "manual_account_only";
  }

  const counterpart = await findCounterpart(tx, subject);

  if (counterpart && enteredPair(subject, counterpart)) {
    return changeEnteredPair(tx, subject, counterpart, type, target);
  }

  if (type !== "transfer") {
    await leaveTransfer(tx, subject, counterpart, type);

    return "saved";
  }

  const keepsLink = target === undefined || (target !== null && "counterpartId" in target && target.counterpartId === counterpart?.id);

  // A booking Ufer created on a manual account for an imported booking exists only for that link: it can keep it or be removed, never be retargeted.
  if (counterpart && createdCounterpart(subject) && target !== null && !keepsLink) {
    return "created_counterpart";
  }

  if (target === undefined) {
    await markManualType(tx, subject.id, "transfer");

    // Only a booking nobody linked or unlinked is paired automatically; pairing skips manual link decisions.
    if (!subject.transfer_id) {
      await pairTransfers(tx, environment());
    }

    return "saved";
  }

  if (target && "counterpartId" in target) {
    return linkExisting(tx, subject, counterpart, target.counterpartId);
  }

  if (target && "accountId" in target) {
    return linkManualAccount(tx, subject, counterpart, target.accountId);
  }

  await transferWithoutCounterpart(tx, subject, counterpart);

  return "saved";
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

/**
 * Lets a booking entered in Ufer follow the imported booking it is linked with; runs before the corrected values are written.
 * A redelivered date is always mirrored. An amount in the same currency and direction is mirrored as the opposite amount and the pair stays linked, so the manual account's balance follows the correction.
 * A correction that ends the link (the other direction or no amount) still mirrors the amount into a manual entry, which is detached first; a counterpart Ufer created is removed by `releaseOutdatedLinks`, as is every link after a currency change.
 */
export async function followImportedCorrections(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[]) {
  const deliveries = new Map(entries.map(entry => [entry.reference, entry]));

  if (!deliveries.size) {
    return;
  }

  const linked = await tx.select({
    id: transactions.id
  }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, [...deliveries.keys()]), isNotNull(transactions.transfer_id)));

  for (const { id } of linked) {
    const booking = await findSubject(tx, id);
    const counterpart = booking ? await findCounterpart(tx, booking) : undefined;
    const delivery = booking ? deliveries.get(booking.provider_reference) : undefined;

    if (!booking || !counterpart || !delivery || enteredInUfer(booking) || !enteredInUfer(counterpart)) {
      continue;
    }

    const sameCurrency = delivery.currency === counterpart.currency;
    const keepsLink = sameCurrency && delivery.amount !== 0 && Math.sign(delivery.amount) === Math.sign(booking.amount_minor);

    if (keepsLink) {
      await tx.update(transactions).set({
        booking_date: delivery.date,
        amount_minor: -delivery.amount
      }).where(eq(transactions.id, counterpart.id));
    } else if (sameCurrency && !createdCounterpart(counterpart)) {
      // Detach before changing direction, and prevent the pairing pass from hiding the corrected income or expense as a transfer again.
      await tx.update(transactions).set({
        transfer_id: null,
        transfer_source: "manual",
        booking_date: delivery.date,
        amount_minor: -delivery.amount
      }).where(eq(transactions.id, counterpart.id));
    } else {
      await tx.update(transactions).set({
        booking_date: delivery.date
      }).where(eq(transactions.id, counterpart.id));
    }
  }
}

/**
 * Releases the links of stored bookings whose redelivered amount or currency no longer pairs with their counterpart (the exact opposite amount in the same currency), before the corrected values are written.
 * The corrected booking takes the type its delivery implies, its counterpart stays a transfer without a counterpart, and a counterpart Ufer created on a manual account is removed. Links released here keep an automatic source; entered legs detached while following a correction keep their exclusion from pairing.
 */
export async function releaseOutdatedLinks(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[]) {
  const deliveries = new Map(entries.map(entry => [entry.reference, entry]));

  if (!deliveries.size) {
    return;
  }

  const linked = await tx.select({
    id: transactions.id,
    provider_reference: transactions.provider_reference,
    amount_minor: transactions.amount_minor,
    currency: transactions.currency,
    transfer_id: transactions.transfer_id
  }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, [...deliveries.keys()]), isNotNull(transactions.transfer_id)));

  for (const booking of linked) {
    const delivery = deliveries.get(booking.provider_reference);
    const unchanged = delivery?.amount === booking.amount_minor && delivery.currency === booking.currency;

    if (!delivery || unchanged || !booking.transfer_id) {
      continue;
    }

    const counterpart = await tx.select({
      id: transactions.id,
      provider_reference: transactions.provider_reference,
      amount_minor: transactions.amount_minor,
      currency: transactions.currency
    }).from(transactions).where(and(eq(transactions.transfer_id, booking.transfer_id), ne(transactions.id, booking.id))).get();
    const stillPairs = counterpart !== undefined && delivery.amount === -counterpart.amount_minor && delivery.currency === counterpart.currency;

    if (stillPairs) {
      continue;
    }

    await tx.update(transactions).set({
      transfer_id: null,
      transfer_source: "auto",
      type: derivedTransactionType(delivery.amount, delivery.transfer),
      type_source: "auto"
    }).where(eq(transactions.id, booking.id));

    if (!counterpart) {
      continue;
    }

    if (counterpart.provider_reference.startsWith(createdCounterpartPrefix)) {
      await tx.delete(transactions).where(eq(transactions.id, counterpart.id));
    } else {
      await tx.update(transactions).set({
        transfer_id: null,
        transfer_source: "auto"
      }).where(eq(transactions.id, counterpart.id));
    }
  }
}
