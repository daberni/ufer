import { and, eq, ne, sql, type AnyColumn } from "drizzle-orm";
import { accounts, transactions } from "@/server/database/schema";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/lib/booking-references";
import { manualAccountTypes } from "@/lib/transaction-types";
import { notSplit, notSplitBooking } from "./split-repository";
import { manualLinkDays } from "./transfer-pairing";
import { notTradeLeg } from "./trade-leg-rules";
import type { Subject } from "./transfer-subjects";

export type Booking = Record<"id" | "account_id" | "amount_minor" | "suppressed_at" | "transfer_id" | "transfer_source" | "type" | "type_source" | "type_rule_id" | "type_transfer_account_id", AnyColumn>;

export function windowStart(days: number) {
  return `-${days} days`;
}

export function windowEnd(days: number) {
  return `+${days} days`;
}

// Bookings automatic pairing may link: visible, unlinked, not split, never linked or unlinked by a person, and either a transfer or an income or expense that neither a person nor a rule set.
export function pairable(booking: Booking) {
  return sql`${booking.suppressed_at} IS NULL AND ${booking.transfer_id} IS NULL AND ${booking.transfer_source}='auto' AND ${booking.amount_minor}<>0 AND ${notSplitBooking(booking)} AND (${booking.type}='transfer' OR (${booking.type_source}='auto' AND ${booking.type_rule_id} IS NULL AND ${booking.type} IN ('income','expense')))`;
}

// A booking whose rule names the transfer's account pairs only with a booking on that account. A rule naming the booking's own account, as for the other leg of the same transfer, does not constrain it.
export function allowedByRule(booking: Booking, other: Booking) {
  return sql`(${booking.type_transfer_account_id} IS NULL OR ${booking.type_transfer_account_id}=${booking.account_id} OR ${booking.type_transfer_account_id}=${other.account_id})`;
}

/** Bookings a person can link with `subject`: unlinked, not split, the exact opposite amount in the same currency, on another active account, within the manual link window. The dialog offers only these and linking accepts only these. */
export function linkCandidate(subject: Subject) {
  const inWindow = sql`${transactions.date} BETWEEN date(${subject.date},${windowStart(manualLinkDays)}) AND date(${subject.date},${windowEnd(manualLinkDays)})`;

  // A link involving an archived account only changes types; a booking entered in Ufer would follow the link's date, so it is no candidate then.
  const entered = sql`(${accounts.provider}='manual' AND (${transactions.provider_reference} LIKE ${`${manualEntryPrefix}%`} OR ${transactions.provider_reference} LIKE ${`${createdCounterpartPrefix}%`}))`;
  const unfrozen = subject.account_archived_at !== null ? sql`NOT ${entered}` : sql`(${accounts.archived_at} IS NULL OR NOT ${entered})`;

  return and(unfrozen, ne(transactions.account_id, subject.account_id), eq(transactions.amount_minor, -subject.amount_minor), eq(transactions.currency, subject.currency), sql`${transactions.transfer_id} IS NULL`, sql`${transactions.suppressed_at} IS NULL`, sql`${transactions.amount_minor}<>0`, notSplit, notTradeLeg, inWindow);
}

/** Whether Ufer created this booking on a manual account as the counterpart of another booking. */
export function createdCounterpart(booking: Pick<Subject, "provider_reference">) {
  return booking.provider_reference.startsWith(createdCounterpartPrefix);
}

/** Whether a booking was entered in Ufer rather than imported from a bank or a CSV file: a manual entry or a created counterpart on a manual account, or a bank-linked account's opening balance or adjustment. */
export function enteredInUfer(booking: Pick<Subject, "account_provider" | "provider_reference" | "type">) {
  const reference = booking.provider_reference;

  if (booking.account_provider !== "manual") {
    return reference.startsWith(manualEntryPrefix) && manualAccountTypes.includes(booking.type);
  }

  return reference.startsWith(manualEntryPrefix) || reference.startsWith(createdCounterpartPrefix);
}

/**
 * Whether two linked bookings form one movement between manual accounts entered in Ufer. Neither side is the source of truth: either side edits, moves or removes the pair.
 * When one side was imported, the imported booking is the source of truth and the entered side follows it.
 */
export function enteredPair(subject: Subject, counterpart: Subject) {
  return enteredInUfer(subject) && enteredInUfer(counterpart);
}

// Changing a linked booking can rewrite, unlink or delete its counterpart, so a link to an archived account keeps both sides read-only.
export function touchesArchived(subject: Subject, counterpart: Subject | undefined) {
  return subject.account_archived_at !== null || (counterpart !== undefined && counterpart.account_archived_at !== null);
}
