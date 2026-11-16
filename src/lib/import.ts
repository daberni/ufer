import { HttpError, ValidationError } from "./errors";
import { parse } from "csv-parse/sync";
import { Temporal } from "temporal-polyfill";
import { minorUnits } from "./money";
import { today, validDate } from "./time";
import type { Entry } from "@/features/transactions/server/transaction-entry";

type CsvRow = Record<string, string>;

export function parseBalancesCsv(text: string, currency: string, now = Temporal.Now.instant()) {
  const rows = readCsvRows(text, "balances", "date,balance,currency");
  const dates = new Set<string>();
  const latestDate = today(now);

  return rows.map((row, index) => {
    const line = index + 2;

    if (!validDate(row.date || "") || isFutureDate(row.date, latestDate) || !row.balance || row.currency !== currency) {
      throw new ValidationError(`CSV row ${line}: invalid date, balance, or account currency.`);
    }

    if (dates.has(row.date)) {
      throw new ValidationError(`CSV row ${line}: multiple balances have the same date.`);
    }

    dates.add(row.date);

    return {
      date: row.date,
      amount: rowAmount(line, row.balance, currency)
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function parseTransactionsCsv(text: string, currency: string, now = Temporal.Now.instant()): Entry[] {
  const rows = readCsvRows(text, "transactions", "id,date,amount,currency,counterparty,description");
  const references = new Set<string>();
  const latestDate = today(now);

  return rows.map((row, index) => {
    const line = index + 2;

    if (!row.id || row.id.length > 200 || !validDate(row.date || "") || !row.amount || row.currency !== currency) {
      throw new ValidationError(`CSV row ${line}: id, ISO date, amount, or account currency is missing or invalid.`);
    }

    if (isFutureDate(row.date, latestDate)) {
      throw new ValidationError(`CSV row ${line}: the booking date is in the future.`);
    }

    if (references.has(row.id)) {
      throw new ValidationError(`CSV row ${line}: duplicate ID.`);
    }

    references.add(row.id);

    return {
      reference: `csv:${row.id}`,
      date: row.date,
      amount: rowAmount(line, row.amount, currency),
      currency,
      counterparty: (row.counterparty || "").slice(0, 500),
      description: (row.description || "").slice(0, 2000)
    };
  });
}

function readCsvRows(text: string, noun: string, expectedColumns: string) {
  if (Buffer.byteLength(text, "utf8") > 1_000_000) {
    throw new HttpError(413, "CSV files cannot exceed 1 MB.");
  }

  let rows: CsvRow[];

  try {
    rows = parse(text, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: text.split(/\r?\n/)[0].includes(";") ? ";" : ",",
      max_record_size: 20_000
    });
  } catch {
    throw new ValidationError(`Could not read CSV. Expected ${expectedColumns}.`);
  }

  if (!rows.length || rows.length > 10_000) {
    throw new ValidationError(`CSV must contain between 1 and 10,000 ${noun}.`);
  }

  return rows;
}

function isFutureDate(value: string, latestDate: Temporal.PlainDate) {
  return Temporal.PlainDate.compare(Temporal.PlainDate.from(value), latestDate) > 0;
}

function rowAmount(line: number, value: string, currency: string) {
  try {
    return minorUnits(value.replace(",", "."), currency);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError(`CSV row ${line}: ${error.message}`);
    }

    throw error;
  }
}
