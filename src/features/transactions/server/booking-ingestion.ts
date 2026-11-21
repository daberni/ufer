import { and, between, eq, inArray, isNotNull, like, ne } from "drizzle-orm";
import type { DatabaseTransaction } from "@/server/database/connection";
import { transactions } from "@/server/database/schema";
import { createdCounterpartPrefix, mappedReferencePrefix } from "@/lib/booking-references";
import { bookingDays, matchBooking, matchingWindow, prepareBooking, prepareBookings } from "@/lib/booking-matching";
import { derivedTransactionType } from "@/lib/transaction-types";
import type { CategorizedEntry } from "./transaction-entry";
import { createdCounterpart, enteredInUfer } from "./transfer-rules";
import { findCounterpart, findSubject } from "./transfer-subjects";

// Reconciles delivered bookings, from a bank sync or a CSV import, with the bookings an account already stores before they are written.

const referenceChunkSize = 500;

/**
 * Lets a bank delivery take over rows a mapped CSV import saved for the same bookings, matched by the import's duplicate rule. The row gets the bank reference, so the following upsert updates it with the provider data instead of inserting a duplicate; the returned entries carry the row's category, so it survives that upsert, and an income or expense type the file stated against the amount's direction (a refund), unless a rule decides the delivery's type.
 */
export async function adoptImportedRows(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[]) {
  if (entries.length === 0) {
    return entries;
  }

  const window = matchingWindow(entries.flatMap(bookingDays).sort());
  const imported = await tx.select({
    id: transactions.id,
    reference: transactions.provider_reference,
    date: transactions.date,
    amount: transactions.amount_minor,
    counterparty: transactions.counterparty,
    description: transactions.description,
    categoryId: transactions.category_id,
    categoryRuleId: transactions.category_rule_id,
    type: transactions.type,
    typeSource: transactions.type_source,
    typeRuleId: transactions.type_rule_id
  }).from(transactions).where(and(eq(transactions.account_id, accountId), like(transactions.provider_reference, `${mappedReferencePrefix}%`), between(transactions.date, window.from, window.to)));

  if (imported.length === 0) {
    return entries;
  }

  const knownReferences = new Set<string | null>();

  // One bound parameter per reference; chunks stay below SQLite's variable limit for large syncs.
  for (let offset = 0; offset < entries.length; offset += referenceChunkSize) {
    const references = entries.slice(offset, offset + referenceChunkSize).map(entry => entry.reference);
    const known = await tx.select({
      reference: transactions.provider_reference
    }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, references)));

    for (const row of known) {
      knownReferences.add(row.reference);
    }
  }

  const prepared = prepareBookings(imported);
  const used = new Set<string>();
  const adopted: CategorizedEntry[] = [];

  for (const entry of entries) {
    const match = knownReferences.has(entry.reference) ? -1 : matchBooking(prepareBooking(entry), prepared, index => !used.has(imported[index].id));
    // An ambiguous match inserts the bank booking rather than guessing which imported row it replaces.
    const row = typeof match === "number" && match >= 0 ? imported[match] : undefined;

    if (!row) {
      adopted.push(entry);
      continue;
    }

    used.add(row.id);
    // A repeated bank entry must not adopt a second imported row under the same reference.
    knownReferences.add(entry.reference);
    await tx.update(transactions).set({
      provider_reference: entry.reference
    }).where(eq(transactions.id, row.id));
    adopted.push({
      ...entry,
      categoryId: row.categoryId,
      categoryRuleId: row.categoryRuleId,
      ...(entry.ruleType === null && statedType(row) ? {
        ruleType: statedType(row)
      } : {})
    });
  }

  return adopted;
}

/** The income or expense type a CSV file stated against the amount's direction, such as a refund; null when the type is derived, set by a rule or corrected by a person, whose corrections the upsert keeps anyway. */
function statedType(row: {
  amount: number;
  type: string;
  typeSource: string;
  typeRuleId: string | null;
}) {
  const stated = row.type === "income" || row.type === "expense";

  if (!stated || row.typeSource !== "auto" || row.typeRuleId !== null || row.type === derivedTransactionType(row.amount)) {
    return null;
  }

  return row.type as "income" | "expense";
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
        date: delivery.date,
        amount_minor: -delivery.amount
      }).where(eq(transactions.id, counterpart.id));
    } else if (sameCurrency && !createdCounterpart(counterpart)) {
      // Detach before changing direction, and prevent the pairing pass from hiding the corrected income or expense as a transfer again.
      await tx.update(transactions).set({
        transfer_id: null,
        transfer_source: "manual",
        date: delivery.date,
        amount_minor: -delivery.amount
      }).where(eq(transactions.id, counterpart.id));
    } else {
      await tx.update(transactions).set({
        date: delivery.date
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
      type: delivery.ruleType ?? derivedTransactionType(delivery.amount, delivery.transfer),
      type_source: "auto",
      type_rule_id: delivery.typeRuleId,
      type_transfer_account_id: delivery.typeTransferAccountId
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
