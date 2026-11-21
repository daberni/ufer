import type { CsvDelimiter, CsvEncoding } from "./csv-reading";
import type { DateFormat, DecimalSeparator } from "./csv-values";

// Column roles of a CSV file: the format settings, a mapping of columns to fields, suggestions from header names and completeness checks.

export type CsvSettings = {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  decimal: DecimalSeparator;
  dateFormat: DateFormat;
};

/** Zero-based column indexes; null leaves a field unmapped. Either `amount` or at least one of `debit`/`credit` is required. */
export type CsvMapping = {
  date: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  payee: number | null;
  description: number | null;
  currency: number | null;
  category: number | null;
  account: number | null;
  /** A transaction ID from the export; when mapped, it identifies the row on reimport instead of its content. */
  id: number | null;
  /** A transaction type column; rows marked as a transfer import as transfers, every other row's type follows its amount. */
  type: number | null;
};

export const emptyMapping: CsvMapping = {
  date: null,
  amount: null,
  debit: null,
  credit: null,
  payee: null,
  description: null,
  currency: null,
  category: null,
  account: null,
  id: null,
  type: null
};

// A generic "Type" column is never guessed: banks use "Transfer" for external payments, and an internal transfer drops out of cash flow. Templates map it explicitly.
const headerHints: Record<Exclude<keyof CsvMapping, "type">, RegExp> = {
  date: /^(booking ?date|date|buchungsdatum|datum|buchungstag|transaction date)$/i,
  amount: /^(amount|betrag|value|amount \(\w+\))$/i,
  debit: /^(debit|soll|withdrawal|outflow|ausgang)$/i,
  credit: /^(credit|haben|deposit|inflow|eingang)$/i,
  payee: /^(payee|counterparty|name|empfänger|auftraggeber|merchant|partner ?name|beneficiary)$/i,
  description: /^(description|memo|verwendungszweck|purpose|buchungstext|reference|text|notes?)$/i,
  currency: /^(currency|währung|waehrung|ccy)$/i,
  category: /^(category|kategorie|tags?)$/i,
  account: /^(account|konto|account name)$/i,
  id: /^(id|transaction ?id|booking ?id|reference ?id)$/i
};

/** Guesses a mapping from common header names; the person reviews and adjusts it. */
export function suggestMapping(header: string[]): CsvMapping {
  const mapping = {
    ...emptyMapping
  };

  for (const field of Object.keys(headerHints) as (keyof typeof headerHints)[]) {
    const index = header.findIndex(column => headerHints[field].test(column.trim()));

    mapping[field] = index >= 0 ? index : null;
  }

  // Only one amount mode may be mapped; a signed amount column wins over debit and credit.
  if (mapping.amount !== null) {
    mapping.debit = null;
    mapping.credit = null;
  }

  return mapping;
}

/** Why a mapping cannot produce rows yet; null when it is complete. */
export function mappingProblem(mapping: CsvMapping) {
  if (mapping.date === null) {
    return "Map the booking date column.";
  }

  if (mapping.amount === null && mapping.debit === null && mapping.credit === null) {
    return "Map an amount column, or debit and credit columns.";
  }

  if (mapping.amount !== null && (mapping.debit !== null || mapping.credit !== null)) {
    return "Map either an amount column or debit and credit columns, not both.";
  }

  if (mapping.debit !== null && mapping.debit === mapping.credit) {
    return "Map debit and credit to different columns.";
  }

  if (mapping.payee === null && mapping.description === null) {
    return "Map a payee or description column.";
  }

  return null;
}
