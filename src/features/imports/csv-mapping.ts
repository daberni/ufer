import { parse } from "csv-parse/browser/esm/sync";
import { Temporal } from "temporal-polyfill";

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
};

/** A mapped row with its occurrence: how many rows for the same target account with the same date, amount and normalized texts precede it, counting only rows whose currency the target accepts. It keeps genuine repeats distinct, and identical rows get the same set of references however the export orders them or which other accounts it contains. */
export type ImportRow = MappedRow & {
  occurrence: number;
};

/** Longest amount text and digit counts accepted; anything longer is a row error rather than a rejected request. */
const maxAmountLength = 40;
const maxIntegerDigits = 15;
const maxFractionDigits = 6;

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

const delimiters: CsvDelimiter[] = [";", ",", "\t", "|"];

/** The candidate delimiter that splits the first records into the most columns, counting only records with the header's column count. */
export function detectDelimiter(text: string): CsvDelimiter {
  const scores = delimiters.map(delimiter => {
    try {
      const [header = [], ...rows] = parseCsv(text, delimiter, 50);

      return header.length < 2 ? 0 : header.length * (1 + rows.filter(row => row.length === header.length).length);
    } catch {
      return 0;
    }
  });
  const best = scores.indexOf(Math.max(...scores));

  return scores[best] > 0 ? delimiters[best] : ",";
}

/** A CSV record with the physical line it starts on, counting from 1. */
export type CsvRecord = {
  cells: string[];
  line: number;
};

/** Parses CSV text with csv-parse into trimmed cells; quotes inside unquoted cells are literal, line endings may be mixed, and blank records are dropped. */
export function parseCsvRecords(text: string, delimiter: string, toLine?: number): CsvRecord[] {
  // With `info`, csv-parse returns each record with its parsing metadata.
  const records = parse(text, {
    delimiter,
    record_delimiter: ["\r\n", "\n", "\r"],
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    info: true,
    to_line: toLine
  }) as unknown as {
    record: string[];
    info: {
      lines: number;
    };
  }[];

  return records.map(({
    record,
    info
  }) => ({
    cells: record.map(cell => cell.trim()),
    // csv-parse reports the line a record ends on; quoted line breaks move its start back.
    line: info.lines - record.reduce((breaks, cell) => breaks + cell.split("\n").length - 1, 0)
  })).filter(record => record.cells.some(cell => cell !== ""));
}

export function parseCsv(text: string, delimiter: string, toLine?: number): string[][] {
  return parseCsvRecords(text, delimiter, toLine).map(record => record.cells);
}

// Two-digit years belong to the most recent century that does not put them in the future.
function twoDigitYear(value: number) {
  const currentYear = new Date().getUTCFullYear();

  return 2000 + value > currentYear ? 1900 + value : 2000 + value;
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

  const year = groups.year.length === 2 ? twoDigitYear(Number(groups.year)) : Number(groups.year);

  try {
    return Temporal.PlainDate.from({
      year,
      month: Number(groups.month),
      day: Number(groups.day)
    }, {
      overflow: "reject"
    }).toString();
  } catch {
    return null;
  }
}

const currencySymbols: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  // Shared by several currencies: the row keeps the symbol, and only an account in one of its currencies accepts it.
  "$": "$",
  "¥": "¥"
};

const ambiguousSymbols: Record<string, string[]> = {
  "$": ["USD", "CAD", "AUD", "NZD", "HKD", "SGD", "MXN", "TWD", "ARS", "CLP", "COP"],
  "¥": ["JPY", "CNY"]
};

/** Whether a row's stated currency, an ISO code or an ambiguous symbol, allows the account currency; rows without a currency allow any. */
export function currencyAllows(stated: string | null, accountCurrency: string) {
  if (!stated) {
    return true;
  }

  return (ambiguousSymbols[stated] ?? [stated]).includes(accountCurrency);
}

let isoCurrencies: Set<string> | undefined;

const leadingAffix = /^([-+(]?)\s*(€|£|\$|¥|[A-Za-z]{3}(?![A-Za-z]))\s*/;
const trailingAffix = /\s*(€|£|\$|¥|(?<![A-Za-z])[A-Za-z]{3})\s*([-)]?)$/;

/** Splits at most one currency symbol or ISO 4217 code off the start or end of an amount. Anything else, such as a symbol between digits or a second affix, stays in the text and makes the amount invalid. */
export function splitCurrency(value: string): {
  text: string;
  currency: string | null;
} {
  const text = value.trim();
  const leading = leadingAffix.exec(text);
  const trailing = trailingAffix.exec(text);
  const leadingCurrency = leading ? affixCurrency(leading[2]) : undefined;
  const trailingCurrency = trailing ? affixCurrency(trailing[1]) : undefined;

  if (leading && leadingCurrency !== undefined && !(trailing && trailingCurrency !== undefined)) {
    return {
      text: `${leading[1]}${text.slice(leading[0].length)}`,
      currency: leadingCurrency
    };
  }

  if (trailing && trailingCurrency !== undefined && !(leading && leadingCurrency !== undefined)) {
    return {
      text: `${text.slice(0, trailing.index)}${trailing[2]}`,
      currency: trailingCurrency
    };
  }

  return {
    text,
    currency: null
  };
}

/** The currency an affix names: the symbol itself when it is ambiguous, undefined when it is no currency. */
function affixCurrency(affix: string) {
  if (Object.hasOwn(currencySymbols, affix)) {
    return currencySymbols[affix];
  }

  isoCurrencies ??= new Set(Intl.supportedValuesOf("currency"));

  return isoCurrencies.has(affix.toUpperCase()) ? affix.toUpperCase() : undefined;
}

/** Reads a money amount with the given decimal separator into an exact signed decimal string with a point. It tolerates one currency symbol or code, spaces and apostrophes as grouping, consistent thousands separators, and exactly one sign marker: a leading or trailing minus, a leading plus, or accounting parentheses. Anything else, including more than 15 integer or 6 fraction digits, is invalid. */
export function parseAmount(value: string, decimal: DecimalSeparator): string | null {
  if (value.length > maxAmountLength) {
    return null;
  }

  // Whitespace between digits and apostrophes stay until they are validated as groups of three; other whitespace is dropped.
  let text = splitCurrency(value).text.replace(/\s+(?!\d)|(?<!\d)\s+/gu, "");
  const separated = /^(\D*)(\d{1,3}(?:[\s'’]\d{3})+)(?!\d)/u.exec(text);

  if (separated) {
    text = separated[1] + separated[2].replace(/[\s'’]/gu, "") + text.slice(separated[0].length);
  }

  const parenthesized = /^\(.*\)$/.test(text);
  const markers = [parenthesized, text.startsWith("-"), text.endsWith("-") && text.length > 1, text.startsWith("+")].filter(Boolean).length;

  if (markers > 1) {
    return null;
  }

  const negative = markers === 1 && !text.startsWith("+");

  // Parentheses count only as a matching pair around the whole value; a lone one stays and makes the amount invalid.
  text = parenthesized ? text.slice(1, -1) : text.replace(/^[+-]|-$/g, "");

  const grouping = decimal === "," ? "." : ",";
  const grouped = new RegExp(`^\\d{1,3}(\\${grouping}\\d{3})+(\\${decimal}\\d+)?$`);
  const plain = new RegExp(`^\\d+(\\${decimal}\\d+)?$`);

  if (grouped.test(text)) {
    text = text.split(grouping).join("");
  } else if (!plain.test(text)) {
    return null;
  }

  const [integer, fraction = ""] = text.split(decimal);
  const whole = integer.replace(/^0+(?=\d)/, "");

  if (whole.length > maxIntegerDigits || fraction.length > maxFractionDigits) {
    return null;
  }

  const normalized = fraction ? `${whole}.${fraction}` : whole;

  return negative && /[1-9]/.test(normalized) ? `-${normalized}` : normalized;
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

  if (mapping.debit !== null && mapping.debit === mapping.credit) {
    return "Map debit and credit to different columns.";
  }

  if (mapping.payee === null && mapping.description === null) {
    return "Map a payee or description column.";
  }

  return null;
}

/** Turns data rows (without the header) into mapped rows and row-level errors. `lines` gives each row's physical line in the file; without it, rows count from line 2. */
export function mapRows(rows: string[][], mapping: CsvMapping, settings: CsvSettings, lines?: number[]) {
  const mapped: MappedRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, index) => {
    const line = lines?.[index] ?? index + 2;
    const cell = (column: number | null) => column === null ? "" : (row[column] ?? "").trim();
    const failure = (message: string) => errors.push({
      line,
      message
    });
    const date = parseDate(cell(mapping.date), settings.dateFormat);

    if (!date) {
      failure(`The date “${cell(mapping.date).slice(0, 40)}” does not match ${settings.dateFormat}.`);

      return;
    }

    const amount = rowAmount(cell, mapping, settings.decimal);

    if (amount === null) {
      const scientific = [mapping.amount, mapping.debit, mapping.credit].some(column => /\d[eE][+-]?\d/.test(cell(column)));

      failure(scientific ? "Scientific notation is not supported; export amounts as plain numbers." : "The amount is missing or not a number with at most 15 digits and 6 decimal places.");

      return;
    }

    const currency = rowCurrency(cell, mapping);

    if (typeof currency === "object" && currency !== null) {
      failure(currency.error);

      return;
    }

    mapped.push({
      line,
      date,
      amount,
      currency,
      payee: cell(mapping.payee).slice(0, 500),
      description: cell(mapping.description).slice(0, 2000),
      category: cell(mapping.category).slice(0, 100) || null,
      source: cell(mapping.account).slice(0, 200)
    });
  });

  return {
    rows: mapped,
    errors
  };
}

/** Numbers identical rows per target account; `targetOf` resolves a row's source account to its target and `currencyOf` to that target's currency, when known. */
export function assignOccurrences(rows: MappedRow[], targetOf: (source: string) => string, currencyOf: (source: string) => string | null = () => null): ImportRow[] {
  const seen = new Map<string, number>();

  return rows.map(row => {
    const accountCurrency = currencyOf(row.source);

    // The server rejects such a row, so it must not shift the occurrences, and thereby the references, of the accepted rows.
    if (accountCurrency && !currencyAllows(row.currency, accountCurrency)) {
      return {
        ...row,
        occurrence: 0
      };
    }

    // Matches the server's reference identity, which ignores the stated currency.
    const identity = [targetOf(row.source), row.date, canonicalAmount(row.amount), normalizeText(row.payee), normalizeText(row.description)].join("\u0000");
    const occurrence = seen.get(identity) ?? 0;

    seen.set(identity, occurrence + 1);

    return {
      ...row,
      occurrence
    };
  });
}

/** Lowercase Unicode letters and digits separated by single spaces; punctuation, symbols and diacritics are dropped. */
export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Equal values in minor units have equal canonical forms: "2.5" and "2.50" both become "2.5".
function canonicalAmount(amount: string) {
  return amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount;
}

// Debit and credit columns combine as credit minus the debit's absolute value, so exports that sign their debits work as well. The arithmetic is exact on scaled integers.
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
  const result = absoluteScaled(credit, scale) - absoluteScaled(debit, scale);

  return formatScaled(result, scale);
}

function absoluteScaled(amount: string, scale: number) {
  const [integer, fraction = ""] = amount.replace("-", "").split(".");

  return BigInt(integer + fraction.padEnd(scale, "0"));
}

function formatScaled(value: bigint, scale: number) {
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";

  return `${value < 0n ? "-" : ""}${integer}${fraction}`;
}

/** The row's currency from the currency column and any currency on the amount cells; conflicting or unknown codes are row errors. */
function rowCurrency(cell: (column: number | null) => string, mapping: CsvMapping): string | null | {
  error: string;
} {
  const columns = mapping.amount !== null ? [mapping.amount] : [mapping.debit, mapping.credit];
  const columnText = cell(mapping.currency);
  const columnCurrency = columnText ? affixCurrency(columnText) : null;

  if (columnText && (columnCurrency === undefined || columnText.length !== 3)) {
    return {
      error: `The currency “${columnText.slice(0, 20)}” is not an ISO 4217 code.`
    };
  }

  const found = new Set([columnCurrency, ...columns.map(column => splitCurrency(cell(column)).currency)].filter((currency): currency is string => Boolean(currency)));
  const codes = [...found].filter(currency => !Object.hasOwn(ambiguousSymbols, currency));
  const symbols = [...found].filter(currency => Object.hasOwn(ambiguousSymbols, currency));
  // A code settles which currency an ambiguous symbol on the same row means.
  const consistent = codes.length > 0 ? codes.length === 1 && symbols.every(symbol => currencyAllows(symbol, codes[0])) : symbols.length <= 1;

  if (!consistent) {
    return {
      error: `The row names different currencies: ${[...found].sort().join(", ")}.`
    };
  }

  return codes[0] ?? symbols[0] ?? null;
}

function fractionDigits(value: string) {
  return value.split(".")[1]?.length ?? 0;
}

/** Splits mapped rows into request batches that stay well below hosted request body limits. */
export function batchRows(rows: ImportRow[], maxBytes = 1_000_000, maxRows = 2000) {
  const batches: ImportRow[][] = [];
  let current: ImportRow[] = [];
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
