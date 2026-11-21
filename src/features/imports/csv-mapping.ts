import { parse } from "csv-parse/browser/esm/sync";
import { Temporal } from "temporal-polyfill";
import { formatCount } from "@/lib/locale";
import { maximumSplitParts } from "@/features/transactions/split-limits";

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
  /** A transaction ID from the export; when mapped, it identifies the row on reimport instead of its content. */
  id: number | null;
  /** A transaction type column; rows marked as a transfer import as transfers, every other row's type follows its amount. */
  type: number | null;
};

/** A source-specific layout, recognized by its exact header row and mapped by column name. Saved templates also remember account and category choices by source value. */
export type CsvTemplate = {
  id: string;
  name: string;
  builtIn: boolean;
  /** The header row the template recognizes, compared cell by cell after trimming. */
  header: string[];
  settings: Partial<Pick<CsvSettings, "decimal" | "dateFormat">>;
  /** Column positions in `header`; positions rather than names keep repeated header names apart. */
  columns: Partial<Record<keyof CsvMapping, number>>;
  /** Existing account IDs by source account label. */
  accounts: Record<string, string>;
  /** Existing category IDs by category value. */
  categories: Record<string, string>;
};

/** Longest header and template name the saved templates accept; the server applies the same limits. */
export const maxTemplateColumns = 200;

export const maxTemplateNameLength = 100;

export const maxColumnNameLength = 200;

/**
 * Buxfer's transaction export. `Tags` holds the categories, possibly several separated by commas; `Type` marks transfers, which the automatic rule pairs after the import, and `Status`, `Memo` and `IOU` stay unmapped. Amounts are signed except for `Investment purchase`, which Buxfer exports as a positive amount. Until Ufer tracks holdings, a settlement account stands for its cash plus securities at cost, so purchases and sales import hidden with their exported amount and text; capital gains and losses count as ordinary bookings. Buxfer shortens long descriptions with "...", which duplicate matching tolerates because a shortened text is contained in the full one.
 */
export const buxferTemplate: CsvTemplate = {
  id: "builtin:buxfer",
  name: "Buxfer export",
  builtIn: true,
  header: ["ID", "Date", "Description", "Currency", "Amount", "Type", "Tags", "Account", "Status", "Memo", "IOU"],
  settings: {
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  },
  columns: {
    id: 0,
    date: 1,
    description: 2,
    currency: 3,
    amount: 4,
    type: 5,
    category: 6,
    account: 7
  },
  accounts: {},
  categories: {}
};

export const builtInTemplates: CsvTemplate[] = [buxferTemplate];

/** A comparable form of a header row: trimmed cells, order preserved. */
export function headerKey(header: string[]) {
  return JSON.stringify(header.map(column => column.trim()));
}

/** Whether an applied template maps Buxfer's export, whose tags carry split amounts and whose investment trades import hidden: the built-in template or a saved one for the same header. */
export function readsBuxferExport(template: CsvTemplate | null) {
  return template !== null && headerKey(template.header) === headerKey(buxferTemplate.header);
}

/** The first template in `templates` for a header; lists put saved templates before built-in ones, so a person can override a built-in layout. */
export function matchTemplate(header: string[], templates: CsvTemplate[]): CsvTemplate | null {
  const key = headerKey(header);

  return templates.find(template => headerKey(template.header) === key) ?? null;
}

/** The format a template applies: the file's current encoding and delimiter, which the person may have corrected and which decide how the header was read, with the template's date and decimal format over the detected ones. */
export function templateSettings(template: Pick<CsvTemplate, "settings">, detected: CsvSettings, current: CsvSettings | null): CsvSettings {
  return {
    ...detected,
    encoding: current?.encoding ?? detected.encoding,
    delimiter: current?.delimiter ?? detected.delimiter,
    ...template.settings
  };
}

/** A template's name as listed, marking the ones defined in code. */
export function templateLabel(template: Pick<CsvTemplate, "name" | "builtIn">) {
  return template.builtIn ? `${template.name} (built-in)` : template.name;
}

/** A template that recreates a mapping on files with the same header: column positions, the format, and the given account and category choices. */
export function templateFromMapping(name: string, header: string[], mapping: CsvMapping, settings: CsvSettings, accounts: Record<string, string>, categories: Record<string, string>): Omit<CsvTemplate, "id" | "builtIn"> {
  const columns: CsvTemplate["columns"] = {};

  for (const field of Object.keys(mapping) as (keyof CsvMapping)[]) {
    const column = mapping[field];

    if (column !== null && header[column] !== undefined) {
      columns[field] = column;
    }
  }

  return {
    name: name.trim(),
    header: header.map(column => column.trim()),
    settings: {
      decimal: settings.decimal,
      dateFormat: settings.dateFormat
    },
    columns,
    accounts,
    categories
  };
}

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
  /** The export's transaction ID; null without an ID column. */
  id: string | null;
  /** The type column marks the row as a transfer, which automatic pairing then links to its counterpart. */
  transfer: boolean;
  /** Imported as a hidden booking that counts toward no balance, report or pairing, such as a Buxfer investment trade before holdings are tracked. */
  hidden: boolean;
  /** The parts of a split from amount-bearing tags such as Buxfer's `Fuel:45.52,Groceries:5.88`, signed like the row; null for an unsplit row. A split row has no `category`. */
  parts: SplitPartRow[] | null;
  /** The original tag text of a split row, appended to the description if the server cannot take the split. */
  tags: string | null;
};

/** One part of a split row: its category value and signed decimal amount with a point. */
export type SplitPartRow = {
  category: string;
  amount: string;
};

/** A mapped row with its occurrence: how many rows for the same target account with the same date, amount and normalized texts precede it, counting only rows whose currency the target accepts. It keeps genuine repeats distinct, and identical rows get the same set of references however the export orders them or which other accounts it contains. */
export type ImportRow = MappedRow & {
  occurrence: number;
};

/** Longest amount text and digit counts accepted; anything longer is a row error rather than a rejected request. */
const maxAmountLength = 40;
const maxIntegerDigits = 15;
const maxFractionDigits = 6;

/** Longest transaction ID; the server applies the same limit. */
export const maxIdLength = 200;

/** Longest category value, the limit of a category name; the server applies the same limit. */
export const maxCategoryLength = 100;

/** Longest name of a new account; the server applies the same limit. */
export const maxAccountNameLength = 100;

/** Most targets one import request accepts; the server applies the same limit. */
export const maxTargetsPerRequest = 100;

/** Most category choices one import request accepts; the server applies the same limit. */
export const maxCategoryChoicesPerRequest = 1000;

/** Derives an import ID from the file's bytes, shaped as a version 8 UUID: choosing the same file again, for example after signing in anew, resumes its import and reuses the accounts it created. */
export async function importIdFor(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  const hex = [...digest.subarray(0, 16)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const variant = (8 + (parseInt(hex[16], 16) & 3)).toString(16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Longest account value; the server applies the same limit. */
export const maxSourceLength = 200;

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
  account: null,
  id: null,
  type: null
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

/** The header and data rows of a file read with the given settings; null when the file is not valid CSV with them, such as an unterminated quoted field. */
export function readCsvTable(bytes: Uint8Array, settings: Pick<CsvSettings, "encoding" | "delimiter">) {
  const text = decodeCsv(bytes, settings.encoding).text;
  let records: ReturnType<typeof parseCsvRecords>;

  try {
    records = parseCsvRecords(text, settings.delimiter);
  } catch {
    return null;
  }

  const [header, ...rows] = records;

  return {
    header: header?.cells ?? [],
    rows: rows.map(record => record.cells),
    lines: rows.map(record => record.line)
  };
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
    // csv-parse reports the line a record ends on and counts each \r and \n inside quotes as a line, so the same count moves the start back.
    line: info.lines - record.reduce((breaks, cell) => breaks + (cell.match(/\r|\n/g)?.length ?? 0), 0)
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

const ambiguousSymbols = new Set(["$", "¥"]);
const ambiguousSymbolCurrencies = new Map<string, string[]>();

/** The currencies an ambiguous symbol can denote: every currency the runtime writes with that narrow symbol. */
function symbolCurrencies(symbol: string) {
  let currencies = ambiguousSymbolCurrencies.get(symbol);

  if (!currencies) {
    currencies = Intl.supportedValuesOf("currency").filter(code => narrowSymbol(code) === symbol);
    ambiguousSymbolCurrencies.set(symbol, currencies);
  }

  return currencies;
}

function narrowSymbol(code: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol"
  }).formatToParts(0).find(part => part.type === "currency")?.value;
}

/** Whether a row's stated currency, an ISO code or an ambiguous symbol, allows the account currency; rows without a currency allow any. */
export function currencyAllows(stated: string | null, accountCurrency: string) {
  if (!stated) {
    return true;
  }

  const accepted = ambiguousSymbols.has(stated) ? symbolCurrencies(stated) : [stated];

  return accepted.includes(accountCurrency);
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

  // Whitespace between digits and apostrophes stay until they are validated as groups of three of one kind (spaces or apostrophes); other whitespace is dropped.
  let text = splitCurrency(value).text.replace(/\s+(?!\d)|(?<!\d)\s+/gu, "");
  const separated = /^(\D*)(\d{1,3}(?:(?:[ \u00A0\u202F]\d{3})+|(?:['’]\d{3})+))(?!\d)/u.exec(text);

  if (separated) {
    text = separated[1] + separated[2].replace(/[ \u00A0\u202F'’]/gu, "") + text.slice(separated[0].length);
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

/** Applies a template's column positions to a header it matches; positions outside the header stay unmapped. */
export function templateMapping(template: CsvTemplate, header: string[]): CsvMapping {
  const mapping = {
    ...emptyMapping
  };

  for (const [field, column] of Object.entries(template.columns) as [keyof CsvMapping, number][]) {
    mapping[field] = column < header.length ? column : null;
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

/** Turns data rows (without the header) into mapped rows and row-level errors. `lines` gives each row's physical line in the file; without it, rows count from line 2. */
/** Maps CSV rows; the locale formats numbers in row problems. `buxferExport` applies Buxfer's conventions: amount-bearing tags are splits and investment purchases and sales import hidden. Other files keep every category cell as a plain value, since `Project:2026` there is just a name. */
export function mapRows(rows: string[][], mapping: CsvMapping, settings: CsvSettings, locale: string, lines?: number[], buxferExport = false) {
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

      failure(scientific ? "Scientific notation is not supported; export amounts as plain numbers." : `The amount is missing or not a number with at most ${formatCount(15, locale)} digits and ${formatCount(6, locale)} decimal places.`);

      return;
    }

    const currency = rowCurrency(cell, mapping);

    if (typeof currency === "object" && currency !== null) {
      failure(currency.error);

      return;
    }

    // The account value identifies the row's target, so it is never shortened: two long values must not merge.
    const source = cell(mapping.account);

    if (source.length > maxSourceLength) {
      failure(`The account value is longer than ${formatCount(maxSourceLength, locale)} characters.`);

      return;
    }

    // The category value identifies its choice, so it is never shortened: two long values must not merge.
    const tags = cell(mapping.category);
    const transfer = isTransferMarker(cell(mapping.type));
    const hidden = buxferExport && isBuxferTrade(cell(mapping.type));
    const tagged = buxferExport ? tagSplit(tags, amount) : null;
    // Only income and expenses are split. Tags that do not form a valid split import the row unsplit, keeping the tags in its description.
    const split = tagged && "parts" in tagged && !transfer && !hidden ? tagged : null;
    const category = tagged ? "" : tags;
    const description = tagged && !split ? withSplitTags(cell(mapping.description), tags) : cell(mapping.description);

    if (category.length > maxCategoryLength) {
      failure(`The category is longer than ${formatCount(maxCategoryLength, locale)} characters.`);

      return;
    }

    const id = cell(mapping.id);

    if (mapping.id !== null && !id) {
      failure("The ID is empty.");

      return;
    }

    if (id.length > maxIdLength) {
      failure(`The ID is longer than ${formatCount(maxIdLength, locale)} characters.`);

      return;
    }

    mapped.push({
      line,
      date,
      amount,
      currency,
      payee: cell(mapping.payee).slice(0, 500),
      description: description.slice(0, 2000),
      category: category || null,
      source,
      id: mapping.id === null ? null : id,
      transfer,
      hidden,
      parts: split ? split.parts : null,
      tags: split ? tags : null
    });
  });

  return {
    rows: mapped,
    errors
  };
}

/** Type values that mark a transfer, such as Buxfer's "Transfer"; other values leave the type to the amount. */
export function isTransferMarker(value: string) {
  return /^(transfer|umbuchung|übertrag)$/i.test(value.trim());
}

/** Buxfer's types for buying and selling securities, which move value between cash and holdings within the settlement account. */
function isBuxferTrade(type: string) {
  return /^investment (purchase|sale)$/i.test(type.trim());
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

/** Rows whose ID repeats for the same target account; an ID must identify one row, so every row sharing it is rejected. */
export function duplicateIdErrors(rows: MappedRow[], targetOf: (source: string) => string): RowError[] {
  const counts = new Map<string, number>();
  const key = (row: MappedRow) => `${targetOf(row.source)}\u0000${row.id}`;

  for (const row of rows) {
    if (row.id !== null) {
      counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
    }
  }

  return rows.filter(row => row.id !== null && (counts.get(key(row)) ?? 0) > 1).map(row => ({
    line: row.line,
    message: `The ID “${row.id!.slice(0, 40)}” appears more than once for this account.`
  }));
}

/** The tags in a category cell; exports such as Buxfer list several tags separated by commas. */
export function categoryTags(value: string) {
  return value.split(",").map(tag => tag.trim()).filter(Boolean);
}

/** Appends tags that carry amounts but form no valid split to a description, so nothing from the export is lost: `… · Split: Car / Fuel 45.52, Groceries 5.88`. */
export function withSplitTags(description: string, tags: string) {
  const listed = categoryTags(tags).map(tag => {
    const match = amountTag.exec(tag);

    return match ? `${match[1].trim()} ${match[2]}` : tag;
  }).join(", ");
  const text = `Split: ${listed}`;

  return description ? `${description} · ${text}` : text;
}

// A tag ending in a colon and a plain decimal, such as `Car / Fuel:45.52`; the name may contain colons itself.
const amountTag = /^(.+?)\s*:\s*(-?\d{1,15}(?:\.\d{1,6})?)$/;

/**
 * Reads tags that carry amounts, as Buxfer exports a split transaction, into parts signed like the row: a tag's amount counts in the row's direction, a negative one against it.
 * Null when no tag carries an amount, so the cell is an ordinary category value. Otherwise either the parts, which add up exactly to the row's amount, or why they form no valid split.
 */
export function tagSplit(value: string, amount: string): {
  parts: SplitPartRow[];
} | {
  problem: string;
} | null {
  const tags = categoryTags(value);
  const matches = tags.map(tag => amountTag.exec(tag));

  if (!matches.some(Boolean)) {
    return null;
  }

  const unsplit = (reason: string) => ({
    problem: reason
  });

  if (matches.some(match => !match)) {
    return unsplit("A tag has no amount.");
  }

  if (tags.length < 2) {
    return unsplit("A split needs at least two tags with amounts.");
  }

  if (tags.length > maximumSplitParts) {
    return unsplit(`A split has at most ${maximumSplitParts} parts.`);
  }

  const outgoing = amount.startsWith("-");
  const parts = matches.map(match => ({
    category: match![1].trim(),
    amount: outgoing ? negate(match![2]) : match![2]
  }));

  if (parts.some(part => part.category.length > maxCategoryLength)) {
    return unsplit(`A tag is longer than ${maxCategoryLength} characters.`);
  }

  const scale = Math.max(fractionDigits(amount), ...parts.map(part => fractionDigits(part.amount)));

  if (parts.some(part => signedScaled(part.amount, scale) === 0n)) {
    return unsplit("A tag has an amount of 0.");
  }

  const total = parts.reduce((sum, part) => sum + signedScaled(part.amount, scale), 0n);

  if (total !== signedScaled(amount, scale)) {
    return unsplit(`The tag amounts add up to ${formatScaled(total, scale)} instead of ${formatScaled(signedScaled(amount, scale), scale)}.`);
  }

  return {
    parts
  };
}

function negate(amount: string) {
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

function signedScaled(amount: string, scale: number) {
  const value = absoluteScaled(amount, scale);

  return amount.startsWith("-") ? -value : value;
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
  const codes = [...found].filter(currency => !ambiguousSymbols.has(currency));
  const symbols = [...found].filter(currency => ambiguousSymbols.has(currency));
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

/** The category values a row needs choices for: its category, or the categories of its split parts. */
export function rowCategoryValues(row: Pick<MappedRow, "category" | "parts">) {
  if (row.parts) {
    return [...new Set(row.parts.map(part => part.category))];
  }

  return row.category === null ? [] : [row.category];
}

/** Splits mapped rows into request batches that stay well below hosted request body limits. */
export function batchRows(rows: ImportRow[], maxBytes = 1_000_000, maxRows = 2000, maxSources = maxTargetsPerRequest, maxCategories = maxCategoryChoicesPerRequest) {
  const batches: ImportRow[][] = [];
  let current: ImportRow[] = [];
  let sources = new Set<string>();
  let categories = new Set<string>();
  let size = 0;

  for (const row of rows) {
    const rowSize = JSON.stringify(row).length * 2;
    // Each batch sends only the targets of its own rows, so it may hold at most as many source accounts as a request accepts targets.
    const tooManySources = !sources.has(row.source) && sources.size >= maxSources;
    // Likewise for the category choices of its rows' category values.
    const values = rowCategoryValues(row);
    const added = values.filter(value => !categories.has(value)).length;
    const tooManyCategories = added > 0 && categories.size + added > maxCategories;

    if (current.length > 0 && (size + rowSize > maxBytes || current.length >= maxRows || tooManySources || tooManyCategories)) {
      batches.push(current);
      current = [];
      sources = new Set();
      categories = new Set();
      size = 0;
    }

    current.push(row);
    sources.add(row.source);

    for (const value of values) {
      categories.add(value);
    }

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

/** At most as many consumed bookings as a request accepts. */
export const maxConsumedPerRequest = 20_000;

/**
 * Drops matches that no row of a batch starting at `earliestDate` can reach; with date-sorted batches this keeps the list bounded however large the file is.
 * A file with more rows inside that window than a request accepts keeps the latest ones, so the import still completes; only the dropped rows could then absorb a neighbouring row by content.
 */
export function pruneConsumed(consumed: ConsumedBooking[], earliestDate: string) {
  const reach = new Date(Date.parse(`${earliestDate}T00:00:00Z`) - duplicateDateToleranceDays * 86_400_000).toISOString().slice(0, 10);
  const reachable = consumed.filter(booking => booking.date >= reach);

  return reachable.length > maxConsumedPerRequest ? reachable.toSorted((left, right) => left.date.localeCompare(right.date)).slice(-maxConsumedPerRequest) : reachable;
}
