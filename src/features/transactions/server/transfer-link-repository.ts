import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseTransaction } from "@/server/database/connection";
import { transactions } from "@/server/database/schema";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/lib/booking-references";
import type { TransactionType } from "@/lib/transaction-types";
import { createdCounterpart } from "./transfer-rules";
import { findCounterpart, findSubject, type Subject } from "./transfer-subjects";

/** Links bookings as one transfer that a person decided. */
export async function link(tx: DatabaseTransaction, ids: string[]) {
  await tx.update(transactions).set({
    type: "transfer",
    type_source: "manual",
    type_rule_id: null,
    type_transfer_account_id: null,
    transfer_id: randomUUID(),
    transfer_source: "manual"
  }).where(inArray(transactions.id, ids));
}

export async function markManualType(tx: DatabaseTransaction, id: string, type: TransactionType) {
  await tx.update(transactions).set({
    type,
    type_source: "manual",
    type_rule_id: null,
    type_transfer_account_id: null
  }).where(eq(transactions.id, id));
}

/** Marks a transfer as having no counterpart by a person's choice, so automatic pairing never links it. */
export async function markTransferWithoutCounterpart(tx: DatabaseTransaction, id: string) {
  await tx.update(transactions).set({
    type: "transfer",
    type_source: "manual",
    type_rule_id: null,
    type_transfer_account_id: null,
    transfer_source: "manual"
  }).where(eq(transactions.id, id));
}

export async function moveBooking(tx: DatabaseTransaction, id: string, accountId: string) {
  await tx.update(transactions).set({
    account_id: accountId
  }).where(eq(transactions.id, id));
}

/**
 * Creates the counterpart of `subject` on a manual account and links both; the created booking carries its source's id in its reference, so a booking never receives a second one.
 * A person's link is manual. A rule's link stays automatic, so the subject keeps its rule-set type and a person can still correct either side.
 */
export async function createCounterpart(tx: DatabaseTransaction, subject: Subject, accountId: string, decidedBy: "person" | "rule" = "person") {
  const counterpartId = randomUUID();
  const transferId = randomUUID();

  const created = await tx.insert(transactions).values({
    id: counterpartId,
    account_id: accountId,
    provider_reference: `${createdCounterpartPrefix}${subject.id}`,
    date: subject.date,
    amount_minor: -subject.amount_minor,
    currency: subject.currency,
    counterparty: subject.account_name,
    description: subject.description || subject.counterparty,
    category_id: subject.category_id,
    category_source: "manual",
    type: "transfer",
    type_source: "manual",
    type_rule_id: null,
    type_transfer_account_id: null,
    transfer_id: decidedBy === "rule" ? transferId : null
  }).onConflictDoNothing().returning({
    id: transactions.id
  });

  // A rule's pass finds this booking linked already; a person's link removes any earlier created counterpart first.
  if (created.length === 0) {
    if (decidedBy === "person") {
      throw new Error("The booking already has a created counterpart.");
    }

    return;
  }

  if (decidedBy === "person") {
    await link(tx, [subject.id, counterpartId]);

    return;
  }

  await tx.update(transactions).set({
    transfer_id: transferId
  }).where(eq(transactions.id, subject.id));
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
    type_source: "manual",
    type_rule_id: null,
    type_transfer_account_id: null
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
    type_rule_id: null,
    type_transfer_account_id: null,
    transfer_id: null,
    transfer_source: "manual"
  }).where(eq(transactions.id, counterpart.id));
}

/** The entered leg of a pair with an imported booking takes the imported booking's date. */
export async function alignEnteredLeg(tx: DatabaseTransaction, entered: Subject, imported: Subject) {
  await tx.update(transactions).set({
    date: imported.date
  }).where(eq(transactions.id, entered.id));
}

/** Two entered legs share the subject's date and description and name the other account. */
export async function alignEnteredPair(tx: DatabaseTransaction, subject: Subject, counterpart: Subject) {
  await tx.update(transactions).set({
    counterparty: counterpart.account_name
  }).where(eq(transactions.id, subject.id));
  await tx.update(transactions).set({
    counterparty: subject.account_name,
    description: subject.description,
    date: subject.date
  }).where(eq(transactions.id, counterpart.id));
}
