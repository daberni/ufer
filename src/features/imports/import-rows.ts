import { formatCount } from "@/lib/locale";
import { normalizeText } from "@/lib/text";
import { maximumSplitParts } from "@/features/transactions/split-limits";
import type { CsvMapping, CsvSettings } from "./csv-mapping";
import { absoluteScaled, affixCurrency, ambiguousSymbols, canonicalAmount, currencyAllows, formatScaled, fractionDigits, negate, parseAmount, parseDate, signedScaled, splitCurrency, type DecimalSeparator } from "./csv-values";

// Maps parsed CSV rows to import rows by a column mapping and the export's row conventions.

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
  /** The type the type column's value maps to; null keeps the type that follows the amount. A transfer is linked to its counterpart by automatic pairing; an expense with a positive amount is a refund. */
  type: ImportType | null;
  /** Imported as a hidden booking that counts toward no balance, report or pairing, for a type the conventions hide. */
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

/** Longest transaction ID; the server applies the same limit. */
export const maxIdLength = 200;

/** Longest category value, the limit of a category name; the server applies the same limit. */
export const maxCategoryLength = 100;

/** Longest name of a new account; the server applies the same limit. */
export const maxAccountNameLength = 100;

/** Longest account value; the server applies the same limit. */
export const maxSourceLength = 200;

export type RowError = {
  line: number;
  message: string;
};

/** How an export marks its rows beyond plain column values; a template declares them, and every other file uses `defaultConventions`. */
export type RowConventions = {
  /** Amount-bearing tags in the category cell, such as Buxfer's `Fuel:45.52,Groceries:5.88`, split the row. Elsewhere `Project:2026` is just a category name. */
  amountTags: boolean;
  /** Lowercase type values that import hidden, such as investment trades before holdings are tracked. */
  hiddenTypes: string[];
};

export const defaultConventions: RowConventions = {
  amountTags: false,
  hiddenTypes: []
};

/** The types a type column value can map to. */
export const importTypes = ["expense", "income", "transfer"] as const;

export type ImportType = typeof importTypes[number];

/** Types by lowercase type column value; values without an entry keep the type that follows the amount. */
export type TypeValues = Record<string, ImportType>;

/** Type values recognized without a template: only transfers, since a generic export rarely names other types consistently. */
export const defaultTypeValues: TypeValues = {
  transfer: "transfer",
  umbuchung: "transfer",
  "übertrag": "transfer"
};

/** The lowercase key a type column value is mapped by. */
export function typeValueKey(value: string) {
  return value.trim().toLowerCase();
}

/** The distinct type column values of the rows, in order of first appearance, without empty values. */
export function typeColumnValues(rows: string[][], column: number | null) {
  if (column === null) {
    return [];
  }

  const values = new Map<string, string>();

  for (const row of rows) {
    const value = (row[column] ?? "").trim();
    const key = typeValueKey(value);

    if (key && !values.has(key)) {
      values.set(key, value);
    }
  }

  return [...values].map(([key, label]) => ({
    key,
    label
  }));
}

/** Turns data rows (without the header) into mapped rows and row-level errors; the locale formats numbers in row problems. `lines` gives each row's physical line in the file; without it, rows count from line 2. */
export function mapRows(rows: string[][], mapping: CsvMapping, settings: CsvSettings, locale: string, lines?: number[], conventions = defaultConventions, typeValues = defaultTypeValues) {
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
    const typeValue = typeValueKey(cell(mapping.type));
    const hidden = conventions.hiddenTypes.includes(typeValue);
    const type = !hidden && Object.hasOwn(typeValues, typeValue) ? typeValues[typeValue] : null;
    const transfer = type === "transfer";
    const tagged = conventions.amountTags ? tagSplit(tags, amount) : null;
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
      type,
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

/** The category values a row needs choices for: its category, or the categories of its split parts. */
export function rowCategoryValues(row: Pick<MappedRow, "category" | "parts">) {
  if (row.parts) {
    return [...new Set(row.parts.map(part => part.category))];
  }

  return row.category === null ? [] : [row.category];
}
