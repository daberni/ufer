import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { DatabaseTransaction } from "@/server/database/connection";
import { transactions } from "@/server/database/schema";
import { createdCounterpartPrefix } from "@/lib/booking-references";
import { derivedTransactionType } from "@/lib/transaction-types";
import type { CategorizedEntry } from "./transaction-entry";
import { createdCounterpart, enteredInUfer } from "./transfer-rules";
import { findCounterpart, findSubject } from "./transfer-subjects";

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
