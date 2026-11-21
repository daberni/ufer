import type { DatabaseTransaction } from "@/server/database/connection";
import { derivedTransactionType, type TransactionType } from "@/lib/transaction-types";
import { createdCounterpart, enteredInUfer, enteredPair } from "./transfer-rules";
import { findCounterpart, findLinkCandidate, findManualTarget, findSubject, type Subject } from "./transfer-subjects";
import { alignEnteredLeg, alignEnteredPair, createCounterpart, dissolveLink, link, markManualType, markTransferWithoutCounterpart, moveBooking, removeEnteredLeg } from "./transfer-link-repository";
import { pairTransfers } from "./transfer-pairing-repository";
import { decideTypeChange, type TransferTarget, type TypeChangeResult } from "./type-change-decision";

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

  const candidate = await findLinkCandidate(tx, subject, chosen.id);

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

  await moveBooking(tx, counterpart.id, account.id);
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
      await alignEnteredLeg(tx, entered, imported);
    }

    return;
  }

  await alignEnteredPair(tx, subject, counterpart);
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
    await markTransferWithoutCounterpart(tx, subject.id);

    return;
  }

  if (counterpart && createdCounterpart(subject)) {
    await dissolveLink(tx, counterpart);

    return;
  }

  await dissolveLink(tx, subject);
  await markManualType(tx, subject.id, "transfer");
}

async function changeType(tx: DatabaseTransaction, id: string, type: TransactionType, target?: TransferTarget): Promise<TypeChangeResult> {
  const subject = await findSubject(tx, id);

  if (!subject) {
    return "not_found";
  }

  const counterpart = await findCounterpart(tx, subject);
  const chosen = target && "counterpartId" in target ? await findSubject(tx, target.counterpartId) : undefined;
  const decision = decideTypeChange({
    subject,
    counterpart,
    chosen,
    type,
    target
  });

  switch (decision.kind) {
    case "reject":
      return decision.result;
    case "change_entered_pair":
      return changeEnteredPair(tx, subject, decision.counterpart, type, target);
    case "leave_transfer":
      await leaveTransfer(tx, subject, counterpart, type);

      return "saved";
    case "keep_link":
      await markManualType(tx, subject.id, "transfer");

      if (decision.pairAfterwards) {
        await pairTransfers(tx);
      }

      return "saved";
    case "link_existing":
      return linkExisting(tx, subject, counterpart, decision.counterpartId);
    case "link_manual_account":
      return linkManualAccount(tx, subject, counterpart, decision.accountId);
    case "without_counterpart":
      await transferWithoutCounterpart(tx, subject, counterpart);

      return "saved";
  }
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
