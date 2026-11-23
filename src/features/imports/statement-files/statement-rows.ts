import { amountLimits, maxCategoryLength, maxIdLength, maxSourceLength, type MappedRow, type RowError, type SplitPartRow } from "../import-rows";
import type { ImportMessages } from "../import-messages";

// Shared row building for structured statement files: the same limits as mapped CSV rows, without column mapping.

export const statementFormats = ["camt053", "ofx", "qif"] as const;

export type StatementFormat = typeof statementFormats[number];

/** Format names, which read the same in every language. */
export const statementFormatLabels: Record<StatementFormat, string> = {
  camt053: "CAMT.053",
  ofx: "OFX",
  qif: "QIF"
};

/** A structured statement read into mapped rows; rows that cannot be read are row errors, like a CSV row with a bad cell. */
export type StatementFile = {
  format: StatementFormat;
  rows: MappedRow[];
  errors: RowError[];
};

/** A file of a recognized format that cannot be imported as a whole, such as an investment statement or malformed XML. */
export class StatementFileError extends Error {}

/** The fields a statement entry yields before the shared limits apply. */
export type StatementEntry = {
  line: number;
  date: string | null;
  amount: string | null;
  currency: string | null;
  payee: string;
  description: string;
  category: string | null;
  source: string;
  id: string | null;
  type?: MappedRow["type"];
  /** Why the entry cannot be imported, decided by the format's reader. */
  problem?: string;
  /** Bank statements always state a currency; without one the amount's currency is unknown, so the entry is a row error rather than taking the account's. */
  currencyRequired?: boolean;
  parts?: SplitPartRow[] | null;
  tags?: string | null;
};

/** Collects entries into rows and row errors under the limits the server applies to every mapped row. */
export class StatementRows {
  readonly rows: MappedRow[] = [];
  readonly errors: RowError[] = [];
  // Rows and errors in file order.
  private readonly sequence: (MappedRow | RowError)[] = [];

  constructor(private readonly t: ImportMessages) {}

  /** The rows and errors, each with its own line: decisions and matches are keyed by it, so when entries share a physical line (a file written on one line) every entry is numbered in file order instead. */
  result() {
    const lines = [...this.rows.map(row => row.line), ...this.errors.map(error => error.line)];

    if (new Set(lines).size === lines.length) {
      return {
        rows: this.rows,
        errors: this.errors
      };
    }

    const rows: MappedRow[] = [];
    const errors: RowError[] = [];

    this.sequence.forEach((entry, index) => {
      if ("date" in entry) {
        rows.push({
          ...entry,
          line: index + 1
        });
      } else {
        errors.push({
          ...entry,
          line: index + 1
        });
      }
    });

    return {
      rows,
      errors
    };
  }

  add(entry: StatementEntry) {
    const failure = (message: string) => {
      const error = {
        line: entry.line,
        message
      };

      this.errors.push(error);
      this.sequence.push(error);
    };

    if (!entry.date) {
      failure(this.t("rows.noDate"));

      return;
    }

    if (entry.amount === null) {
      failure(this.t("rows.amount", amountLimits));

      return;
    }

    if (entry.problem) {
      failure(entry.problem);

      return;
    }

    if (entry.currency === null && entry.currencyRequired) {
      failure(this.t("rows.noCurrency"));

      return;
    }

    if (entry.currency !== null && !/^[A-Z]{3}$/.test(entry.currency)) {
      failure(this.t("rows.unknownCurrency", {
        currency: entry.currency.slice(0, 20)
      }));

      return;
    }

    if (entry.source.length > maxSourceLength) {
      failure(this.t("rows.accountLength", {
        max: maxSourceLength
      }));

      return;
    }

    if (entry.category !== null && entry.category.length > maxCategoryLength) {
      failure(this.t("rows.categoryLength", {
        max: maxCategoryLength
      }));

      return;
    }

    if (entry.id !== null && entry.id.length > maxIdLength) {
      failure(this.t("rows.idLength", {
        max: maxIdLength
      }));

      return;
    }

    const row: MappedRow = {
      line: entry.line,
      date: entry.date,
      amount: entry.amount,
      currency: entry.currency,
      payee: entry.payee.slice(0, 500),
      description: entry.description.slice(0, 2000),
      category: entry.category || null,
      source: entry.source,
      id: entry.id || null,
      type: entry.type ?? null,
      hidden: false,
      parts: entry.parts ?? null,
      tags: entry.tags ?? null
    };

    this.rows.push(row);
    this.sequence.push(row);
  }
}

/** Rows of one source in several currencies, such as a multi-currency account whose statements omit the account currency, get a source per currency, since an Ufer account holds one currency. */
export function separateCurrencies(rows: MappedRow[]): MappedRow[] {
  const currencies = new Map<string, Set<string | null>>();

  for (const row of rows) {
    currencies.set(row.source, (currencies.get(row.source) ?? new Set()).add(row.currency));
  }

  // A ledger's name must not equal another account's source, so a numbered suffix keeps it apart from an account whose identifier reads the same.
  const taken = new Set(rows.map(row => row.source));
  const names = new Map<string, string>();
  const ledgerName = (row: MappedRow) => {
    const key = `${row.source}\u0000${row.currency}`;
    const known = names.get(key);

    if (known !== undefined) {
      return known;
    }

    const base = `${row.source} · ${row.currency ?? "no currency"}`;
    let name = base;

    for (let number = 2; taken.has(name); number++) {
      name = `${base} (${number})`;
    }

    taken.add(name);
    names.set(key, name);

    return name;
  };

  return rows.map(row => (currencies.get(row.source)?.size ?? 0) > 1 ? {
    ...row,
    source: ledgerName(row)
  } : row);
}

/** The start tag of an XML document's root element, past any prolog of declarations, comments, processing instructions and document type, however long; null when the text does not start like XML. */
export function xmlRootTag(text: string) {
  let position = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (;;) {
    while (position < text.length && /\s/.test(text[position])) {
      position++;
    }

    const ends = [["<?", "?>"], ["<!--", "-->"], ["<!DOCTYPE", ">"]].find(([open]) => text.startsWith(open, position));

    if (!ends) {
      break;
    }

    const from = position + ends[0].length;
    const close = text.indexOf(">", from);
    const subset = text.indexOf("[", from);
    // A document type's internal subset holds `>` characters of its own and ends with `]>`.
    const internal = ends[0] === "<!DOCTYPE" && subset >= 0 && subset < close;
    const end = internal ? text.indexOf("]", subset) : text.indexOf(ends[1], from);
    const after = internal && end >= 0 ? text.indexOf(">", end) : end;

    if (end < 0 || after < 0) {
      return null;
    }

    position = internal ? after + 1 : end + ends[1].length;
  }

  if (text[position] !== "<") {
    return null;
  }

  const end = text.indexOf(">", position);

  return end < 0 ? null : text.slice(position, end + 1);
}

/** Collapses runs of whitespace, including line breaks inside a field, to single spaces. */
export function cleanText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Whether a calendar date in `YYYY-MM-DD` exists. */
export function validDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return day <= days[month - 1];
}

export function isoDate(year: number, month: number, day: number) {
  return validDate(year, month, day) ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

/** The 1-based line of a character offset in a text. */
export function lineAt(text: string, offset: number, cache: {
  offset: number;
  line: number;
} = {
  offset: 0,
  line: 1
}) {
  let line = cache.line;

  for (let index = cache.offset; index < offset; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
    }
  }

  cache.offset = offset;
  cache.line = line;

  return line;
}
