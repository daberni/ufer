// Reads arbitrary transaction CSV exports in the browser and maps their columns to import rows. Shared with the server, so it must stay free of server-only imports.

/** Days a booking date may differ between duplicates: banks and exports disagree between booking and value date, and weekends shift bookings by up to three days. */
export const duplicateDateToleranceDays = 3;

export type CsvEncoding = "utf-8" | "windows-1252";

export type CsvDelimiter = "," | ";" | "\t" | "|";

export type DecimalSeparator = "." | ",";

export const dateFormats = ["YYYY-MM-DD", "DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "YYYY/MM/DD", "DD.MM.YY"] as const;

export type DateFormat = (typeof dateFormats)[number];

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
};

/** A source-specific layout, such as a later built-in Buxfer export, recognized by its header row and mapped by column name. */
export type CsvTemplate = {
  id: string;
  name: string;
  settings: Partial<CsvSettings>;
  columns: Partial<Record<keyof CsvMapping, string>>;
};

export const builtInTemplates: CsvTemplate[] = [];

/** A mapped row as sent to the server: the date is ISO, the amount a signed decimal with a point. */
export type MappedRow = {
  line: number;
  date: string;
  amount: string;
  currency: string | null;
  payee: string;
  description: string;
  category: string | null;
  /** The source account label from the account column; empty without one. */
  source: string;
  /** How many rows with the same date, amount and normalized texts precede this one in the file, across source accounts; keeps genuine repeats distinct on reimport. Uses the fields of the server's import reference. */
  occurrence: number;
};

export type RowError = {
  line: number;
  message: string;
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
  account: null
};

/** Decodes file bytes: a UTF-8 BOM or valid UTF-8 means UTF-8, anything else is read as Windows-1252, the usual encoding of legacy bank exports. */
export function decodeCsv(bytes: Uint8Array, encoding?: CsvEncoding): {
  text: string;
  encoding: CsvEncoding;
} {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;

  if (encoding === "windows-1252") {
    return {
      text: new TextDecoder("windows-1252").decode(body),
      encoding
    };
  }

  try {
    return {
      text: new TextDecoder("utf-8", {
        fatal: true
      }).decode(body),
      encoding: "utf-8"
    };
  } catch {
    if (encoding === "utf-8") {
      return {
        text: new TextDecoder("utf-8").decode(body),
        encoding
      };
    }

    return {
      text: new TextDecoder("windows-1252").decode(body),
      encoding: "windows-1252"
    };
  }
}

/** The candidate delimiter that occurs most often outside quotes in the first line. */
export function detectDelimiter(text: string): CsvDelimiter {
  const candidates: CsvDelimiter[] = [";", ",", "\t", "|"];
  const firstLine = parseCsv(text.slice(0, 20_000), "\n")[0]?.[0] ?? "";
  const counts = candidates.map(candidate => countOutsideQuotes(firstLine, candidate));
  const best = counts.indexOf(Math.max(...counts));

  return counts[best] > 0 ? candidates[best] : ",";
}

function countOutsideQuotes(line: string, character: string) {
  let quoted = false;
  let count = 0;

  for (const current of line) {
    if (current === "\"") {
      quoted = !quoted;
    } else if (!quoted && current === character) {
      count++;
    }
  }

  return count;
}

/** Splits CSV text into trimmed cells, honoring quoted fields with doubled quotes and line breaks; blank lines are dropped. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  function endRow() {
    row.push(cell.trim());

    if (row.some(value => value !== "")) {
      rows.push(row);
    }

    row = [];
    cell = "";
  }

  for (let index = 0; index < text.length; index++) {
    const current = text[index];

    if (quoted) {
      if (current === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index++;
      } else if (current === "\"") {
        quoted = false;
      } else {
        cell += current;
      }
    } else if (current === "\"") {
      quoted = true;
    } else if (current === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (current === "\n") {
      endRow();
    } else if (current !== "\r") {
      cell += current;
    }
  }

  endRow();

  return rows;
}

/** Reads a date in the given format; null when it is not a real calendar date. */
export function parseDate(value: string, format: DateFormat): string | null {
  const pattern = {
    "YYYY-MM-DD": /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/,
    "DD.MM.YYYY": /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{4})$/,
    "DD/MM/YYYY": /^(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})$/,
    "MM/DD/YYYY": /^(?<month>\d{1,2})\/(?<day>\d{1,2})\/(?<year>\d{4})$/,
    "DD-MM-YYYY": /^(?<day>\d{1,2})-(?<month>\d{1,2})-(?<year>\d{4})$/,
    "YYYY/MM/DD": /^(?<year>\d{4})\/(?<month>\d{1,2})\/(?<day>\d{1,2})$/,
    "DD.MM.YY": /^(?<day>\d{1,2})\.(?<month>\d{1,2})\.(?<year>\d{2})$/
  }[format];
  // Bank exports often append a time to the booking date.
  const groups = pattern.exec(value.trim().split(/[ T]/)[0])?.groups;

  if (!groups) {
    return null;
  }

  const year = groups.year.length === 2 ? 2000 + Number(groups.year) : Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Reads a money amount with the given decimal separator into a signed decimal string with a point; tolerates currency symbols, grouping, a trailing minus and accounting parentheses. */
export function parseAmount(value: string, decimal: DecimalSeparator): string | null {
  let text = value.replace(/[\s '’]/g, "").replace(/[A-Za-z€$£¥]/g, "");
  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  const grouping = decimal === "," ? "." : ",";
  const grouped = new RegExp(`^\\d{1,3}(\\${grouping}\\d{3})+(\\${decimal}\\d+)?$`);
  const plain = new RegExp(`^\\d+(\\${decimal}\\d+)?$`);

  if (grouped.test(text)) {
    text = text.split(grouping).join("");
  } else if (!plain.test(text)) {
    return null;
  }

  const normalized = text.replace(decimal, ".").replace(/^0+(?=\d)/, "");

  return negative && Number(normalized) !== 0 ? `-${normalized}` : normalized;
}

/** The date format that reads the most samples, preferring the earlier format on ties; a few broken rows do not change the detected format. */
export function detectDateFormat(samples: string[]): DateFormat {
  const filled = samples.filter(sample => sample.trim() !== "");
  const scores = dateFormats.map(format => filled.filter(sample => parseDate(sample, format) !== null).length);
  const best = scores.indexOf(Math.max(...scores));

  return scores[best] > 0 ? dateFormats[best] : "YYYY-MM-DD";
}

/** A comma decimal when samples only read as amounts with a comma, or end in a comma followed by one or two digits. */
export function detectDecimal(samples: string[]): DecimalSeparator {
  const filled = samples.filter(sample => sample.trim() !== "");
  const comma = filled.filter(sample => parseAmount(sample, ",") !== null).length;
  const point = filled.filter(sample => parseAmount(sample, ".") !== null).length;

  if (comma !== point) {
    return comma > point ? "," : ".";
  }

  return filled.some(sample => /,\d{1,2}\)?-?$/.test(sample.trim())) ? "," : ".";
}

const headerHints: Record<keyof CsvMapping, RegExp> = {
  date: /^(booking ?date|date|buchungsdatum|datum|buchungstag|transaction date)$/i,
  amount: /^(amount|betrag|value|amount \(\w+\))$/i,
  debit: /^(debit|soll|withdrawal|outflow|ausgang)$/i,
  credit: /^(credit|haben|deposit|inflow|eingang)$/i,
  payee: /^(payee|counterparty|name|empfänger|auftraggeber|merchant|partner ?name|beneficiary)$/i,
  description: /^(description|memo|verwendungszweck|purpose|buchungstext|reference|text|notes?)$/i,
  currency: /^(currency|währung|waehrung|ccy)$/i,
  category: /^(category|kategorie|tags?)$/i,
  account: /^(account|konto|account name)$/i
};

/** Guesses a mapping from common header names; the person reviews and adjusts it. */
export function suggestMapping(header: string[]): CsvMapping {
  const mapping = {
    ...emptyMapping
  };

  for (const field of Object.keys(headerHints) as (keyof CsvMapping)[]) {
    const index = header.findIndex(column => headerHints[field].test(column.trim()));

    mapping[field] = index >= 0 ? index : null;
  }

  return mapping;
}

/** Applies a template's column names to a header; columns the header lacks stay unmapped. */
export function templateMapping(template: CsvTemplate, header: string[]): CsvMapping {
  const mapping = {
    ...emptyMapping
  };

  for (const [field, column] of Object.entries(template.columns) as [keyof CsvMapping, string][]) {
    const index = header.indexOf(column);

    mapping[field] = index >= 0 ? index : null;
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

  if (mapping.payee === null && mapping.description === null) {
    return "Map a payee or description column.";
  }

  return null;
}

/** Turns data rows (without the header) into mapped rows and row-level errors; line numbers count the header as line 1. */
export function mapRows(rows: string[][], mapping: CsvMapping, settings: CsvSettings) {
  const mapped: MappedRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 2;
    const cell = (column: number | null) => column === null ? "" : (row[column] ?? "").trim();
    const date = parseDate(cell(mapping.date), settings.dateFormat);
    const amount = rowAmount(cell, mapping, settings.decimal);

    if (!date) {
      errors.push({
        line,
        message: `The date “${cell(mapping.date)}” does not match ${settings.dateFormat}.`
      });

      return;
    }

    if (amount === null) {
      errors.push({
        line,
        message: "The amount is missing or not a number."
      });

      return;
    }

    const payee = cell(mapping.payee).slice(0, 500);
    const description = cell(mapping.description).slice(0, 2000);
    const source = cell(mapping.account).slice(0, 200);
    const identity = [date, canonicalAmount(amount), normalizeText(payee), normalizeText(description)].join("\u0000");
    const occurrence = seen.get(identity) ?? 0;

    seen.set(identity, occurrence + 1);
    mapped.push({
      line,
      date,
      amount,
      currency: cell(mapping.currency).toUpperCase() || null,
      payee,
      description,
      category: cell(mapping.category).slice(0, 100) || null,
      source,
      occurrence
    });
  });

  return {
    rows: mapped,
    errors
  };
}

/** Lowercase Unicode letters and digits separated by single spaces; punctuation, symbols and diacritics are dropped. */
export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Equal values in minor units have equal canonical forms: "2.5" and "2.50" both become "2.5".
function canonicalAmount(amount: string) {
  return amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount;
}

// Debit and credit columns combine as credit minus the debit's absolute value, so exports that sign their debits work as well.
function rowAmount(cell: (column: number | null) => string, mapping: CsvMapping, decimal: DecimalSeparator) {
  if (mapping.amount !== null) {
    return parseAmount(cell(mapping.amount), decimal);
  }

  const debitText = cell(mapping.debit);
  const creditText = cell(mapping.credit);

  if (!debitText && !creditText) {
    return null;
  }

  const debit = debitText ? parseAmount(debitText, decimal) : "0";
  const credit = creditText ? parseAmount(creditText, decimal) : "0";

  if (debit === null || credit === null) {
    return null;
  }

  const scale = Math.max(fractionDigits(debit), fractionDigits(credit));
  const factor = 10 ** scale;
  const cents = Math.round(Math.abs(Number(credit)) * factor) - Math.round(Math.abs(Number(debit)) * factor);

  return (cents / factor).toFixed(scale);
}

function fractionDigits(value: string) {
  return value.split(".")[1]?.length ?? 0;
}

/** Splits mapped rows into request batches that stay well below hosted request body limits. */
export function batchRows(rows: MappedRow[], maxBytes = 1_000_000, maxRows = 2000) {
  const batches: MappedRow[][] = [];
  let current: MappedRow[] = [];
  let size = 0;

  for (const row of rows) {
    const rowSize = JSON.stringify(row).length * 2;

    if (current.length > 0 && (size + rowSize > maxBytes || current.length >= maxRows)) {
      batches.push(current);
      current = [];
      size = 0;
    }

    current.push(row);
    size += rowSize;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/** An existing booking an earlier batch matched as a duplicate. */
export type ConsumedBooking = {
  account_id: string;
  reference: string;
  date: string;
};

/** Drops matches that no row of a batch starting at `earliestDate` can reach; with date-sorted batches this keeps the list bounded however large the file is. */
export function pruneConsumed(consumed: ConsumedBooking[], earliestDate: string) {
  const reach = new Date(Date.parse(`${earliestDate}T00:00:00Z`) - duplicateDateToleranceDays * 86_400_000).toISOString().slice(0, 10);

  return consumed.filter(booking => booking.date >= reach);
}
