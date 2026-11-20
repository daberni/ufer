import { HttpError, ValidationError } from "./errors";
import { parse } from "csv-parse/sync";
import { Temporal } from "temporal-polyfill";
import { minorUnits } from "./money";
import { today, validDate } from "./time";
import { formatCount } from "./locale";

type CsvRow = Record<string, string>;

/** Reads balance rows; the locale formats row numbers and limits in error messages. */
export function parseBalancesCsv(text: string, currency: string, locale: string, now = Temporal.Now.instant()) {
  const rows = readCsvRows(text, "balances", "date,balance,currency", locale);
  const dates = new Set<string>();
  const latestDate = today(now);

  return rows.map((row, index) => {
    const line = formatCount(index + 2, locale);

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

const maxCsvBytes = 1_000_000;
const maxCsvRows = 10_000;

function readCsvRows(text: string, noun: string, expectedColumns: string, locale: string) {
  if (Buffer.byteLength(text, "utf8") > maxCsvBytes) {
    throw new HttpError(413, `CSV files cannot exceed ${formatCount(1, locale)} MB.`);
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

  if (!rows.length || rows.length > maxCsvRows) {
    throw new ValidationError(`CSV must contain between ${formatCount(1, locale)} and ${formatCount(maxCsvRows, locale)} ${noun}.`);
  }

  return rows;
}

function isFutureDate(value: string, latestDate: Temporal.PlainDate) {
  return Temporal.PlainDate.compare(Temporal.PlainDate.from(value), latestDate) > 0;
}

function rowAmount(line: string, value: string, currency: string) {
  try {
    return minorUnits(value.replace(",", "."), currency);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError(`CSV row ${line}: ${error.message}`);
    }

    throw error;
  }
}
