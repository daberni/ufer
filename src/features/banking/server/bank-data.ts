import { HttpError, ValidationError } from "@/lib/errors";
import { minorUnits, validDate } from "@/lib/money";
import type { Entry } from "@/features/transactions/server/transaction-entry";
import type { BankTransaction, Balance } from "./enable-banking-client";

export function normalizeTransactions(transactions: BankTransaction[], ownIbans: Set<string>): Entry[] {
  const references = new Map<string, string>();

  return transactions.filter(item => item.status === "BOOK").map(item => {
    const date = item.booking_date || item.value_date || "";

    if (!validDate(date)) {
      throw new HttpError(502, "A booked bank transaction is missing a valid booking date.");
    }

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
      date,
      amount: debit ? -absolute : absolute,
      currency: item.transaction_amount.currency,
      counterparty,
      description: item.remittance_information?.join(" · ") || item.note || "",
      transfer: Boolean(counterIban && ownIbans.has(counterIban))
    };
    const signature = JSON.stringify([entry.date, entry.amount, entry.currency, entry.counterparty, entry.description]);
    const previous = references.get(entry.reference);

    if (previous && previous !== signature) {
      throw new HttpError(502, "The bank returned the same reference for different transactions. Import stopped.");
    }

    references.set(entry.reference, signature);

    return entry;
  });
}

export function selectedBalance(balances: Balance[], currency: string) {
  for (const type of ["CLBD", "ITBD", "CLAV", "ITAV", "PRCD", "XPCD"]) {
    const balance = balances.find(item => item.balance_type === type && item.balance_amount.currency === currency);

    if (balance) {
      return {
        amount: bankAmount(balance.balance_amount.amount, currency),
        date: balance.reference_date || new Date().toISOString().slice(0, 10)
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
