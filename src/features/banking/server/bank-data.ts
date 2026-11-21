import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits } from "@/lib/money";
import { today, validDate } from "@/lib/time";
import type { Entry } from "@/features/transactions/server/transaction-entry";
import type { BankTransaction, Balance } from "./enable-banking-client";
import { providerDetails } from "./provider-details";

export function normalizeTransactions(transactions: BankTransaction[], ownIbans: Set<string>): Entry[] {
  const references = new Map<string, string>();

  return transactions.filter(item => item.status === "BOOK").map(item => {
    const dates = bookingDates(item);

    // transaction_id is not guaranteed unique by Enable Banking. Never silently merge unrelated payments.
    if (!item.entry_reference) {
      throw new HttpError(502, "The bank returned booked transactions without a stable entry_reference. Import stopped to prevent duplicates.");
    }

    const absolute = bankAmount(item.transaction_amount.amount, item.transaction_amount.currency);

    if (absolute < 0 || !["DBIT", "CRDT"].includes(item.credit_debit_indicator)) {
      throw new HttpError(502, "The bank returned an invalid debit/credit indicator.");
    }

    const debit = item.credit_debit_indicator === "DBIT";
    const counterparty = (debit ? item.creditor?.name : item.debtor?.name) || "";
    const counterIban = (debit ? item.creditor_account?.iban : item.debtor_account?.iban)?.replace(/\s/g, "");
    const entry: Entry = {
      reference: `bank:${item.entry_reference}`,
      date: dates.date,
      bankBookingDate: dates.bankBookingDate,
      amount: debit ? -absolute : absolute,
      currency: item.transaction_amount.currency,
      counterparty,
      description: item.remittance_information?.join(" · ") || item.note || "",
      transfer: Boolean(counterIban && ownIbans.has(counterIban)),
      provider: providerDetails(item, debit)
    };
    const signature = JSON.stringify([entry.date, entry.bankBookingDate, entry.amount, entry.currency, entry.counterparty, entry.description]);
    const previous = references.get(entry.reference);

    if (previous && previous !== signature) {
      throw new HttpError(502, "The bank returned the same reference for different transactions. Import stopped.");
    }

    references.set(entry.reference, signature);

    return entry;
  });
}

/**
 * The date a bank booking counts on and the bank's own booking date. The value date is when the money moved, for a card payment the purchase date; the bank books it up to a few days later.
 * A missing or malformed value date falls back to the booking date.
 */
export function bookingDates(item: Pick<BankTransaction, "booking_date" | "value_date">) {
  const booked = item.booking_date && validDate(item.booking_date) ? item.booking_date : null;
  const valued = item.value_date && validDate(item.value_date) ? item.value_date : null;
  const date = valued ?? booked;

  if (!date) {
    throw new HttpError(502, "A booked bank transaction is missing a valid booking or value date.");
  }

  return {
    date,
    bankBookingDate: booked
  };
}

export function selectedBalance(balances: Balance[], currency: string) {
  // Booked balances come first, since only booked money anchors and is compared with an account's bookings.
  for (const type of ["CLBD", "ITBD", "PRCD", "CLAV", "ITAV", "XPCD"]) {
    const balance = balances.find(item => item.balance_type === type && item.balance_amount.currency === currency);

    if (balance) {
      return {
        amount: bankAmount(balance.balance_amount.amount, currency),
        bank_balance_type: balance.balance_type,
        date: balance.reference_date || today().toString()
      };
    }
  }

  throw new HttpError(502, "The bank did not return a supported balance for this account currency.");
}

function bankAmount(value: string, currency: string) {
  try {
    return minorUnits(value, currency);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new HttpError(502, "The bank returned an invalid amount or an unsupported currency.");
    }

    throw error;
  }
}
