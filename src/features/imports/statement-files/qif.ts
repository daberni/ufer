import { twoDigitYear, detectDateFormat, detectDecimal, type DateFormat, negate, parseAmount, parseDate } from "../csv-values";
import { tagSplit, withSplitTags } from "../import-rows";
import { cleanText, StatementFileError, StatementRows, type StatementFile } from "./statement-rows";

// Reads Quicken Interchange Format files into mapped rows. QIF has no transaction IDs, so reimports match by content; dates and decimals have no fixed format and are detected over the whole file like CSV columns.

const transactionTypes = new Set(["bank", "cash", "ccard", "oth a", "oth l"]);

/** Whether the text is a QIF file: its first header line names a type or an account. */
export function looksLikeQif(text: string) {
  return /^\s*!(Type:|Account\b|Option:|Clear:)/i.test(text.slice(0, 1024));
}

type QifRecord = {
  line: number;
  source: string;
  fields: [string, string][];
};

export function readQif(text: string, locale: string): StatementFile {
  const records: QifRecord[] = [];
  let section: "transactions" | "account" | "other" = "other";
  let source = "";
  let accountName = "";
  let current: QifRecord | null = null;

  const lines = text.split(/\r\n|\r|\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith("!")) {
      const header = line.slice(1).toLowerCase();

      if (header.startsWith("type:")) {
        const type = header.slice(5).trim();

        if (type === "invst") {
          throw new StatementFileError("QIF investment accounts are not supported; export a bank, cash or credit card account instead.");
        }

        section = transactionTypes.has(type) ? "transactions" : "other";
      } else if (header === "account") {
        section = "account";
        accountName = "";
      }

      current = null;

      continue;
    }

    if (line === "^") {
      if (section === "account") {
        source = accountName;
      } else if (current) {
        records.push(current);
      }

      current = null;

      continue;
    }

    if (section === "account") {
      if (line[0] === "N") {
        accountName = cleanText(line.slice(1));
      }

      continue;
    }

    if (section !== "transactions") {
      continue;
    }

    current ??= {
      line: index + 1,
      source,
      fields: []
    };
    current.fields.push([line[0], line.slice(1).trim()]);
  }

  // A file without a closing `^` still ends its last transaction.
  const last = current as QifRecord | null;

  if (last && section === "transactions") {
    records.push(last);
  }

  if (records.length === 0) {
    throw new StatementFileError("The QIF file contains no bank, cash or credit card transactions.");
  }

  const value = (record: QifRecord, code: string) => record.fields.find(([field]) => field === code)?.[1] ?? "";
  const dates = records.map(record => qifDate(value(record, "D")));
  const dateFormat = qifDateFormat(dates);
  const amounts = records.flatMap(record => record.fields.filter(([field]) => field === "T" || field === "U" || field === "$").map(([, text]) => text));
  const decimal = detectDecimal(amounts);
  const rows = new StatementRows(locale);

  records.forEach((record, index) => {
    const amount = parseAmount(value(record, "T") || value(record, "U"), decimal);
    const category = value(record, "L");
    // `[Account]` names a transfer to another account in Quicken, not a category.
    const transfer = /^\[.*\]$/.test(category);
    const splits = splitTags(record, decimal, amount);
    const split = splits && amount !== null && !transfer ? tagSplit(splits, amount) : null;
    const parts = split && "parts" in split ? split.parts : null;
    const memo = cleanText(value(record, "M"));
    const description = splits && !parts ? withSplitTags(memo, splits) : memo;

    rows.add({
      line: record.line,
      date: parseDate(dates[index], dateFormat),
      amount,
      currency: null,
      payee: cleanText(value(record, "P")),
      description,
      category: transfer || splits ? null : category || null,
      source: record.source,
      id: null,
      type: transfer ? "transfer" : null,
      parts,
      tags: parts ? splits : null
    });
  });

  return {
    format: "qif",
    rows: rows.rows,
    errors: rows.errors
  };
}

/** The detected date format; slash dates that never show which part is the day follow Quicken, which writes the month first. */
function qifDateFormat(dates: string[]) {
  const detected = detectDateFormat(dates);
  const readable = (format: DateFormat) => dates.filter(date => parseDate(date, format) !== null).length;

  if (detected === "DD/MM/YYYY" && readable("MM/DD/YYYY") === readable("DD/MM/YYYY")) {
    return "MM/DD/YYYY";
  }

  return detected;
}

/** Quicken writes `1/31'24` or `1/31/2024`, sometimes with spaces; the apostrophe separates a two-digit year. */
function qifDate(value: string) {
  const text = value.replace(/\s+/g, "");
  const short = /^(\d{1,2})\/(\d{1,2})['/](\d{2})$/.exec(text);

  if (short) {
    return `${short[1]}/${short[2]}/${twoDigitYear(Number(short[3]))}`;
  }

  return text.replace("'", "/");
}

/** A split transaction's `S` category and `$` amount pairs as amount-bearing tags (`Food:Groceries:12.50`) signed like the row; null without splits. */
function splitTags(record: QifRecord, decimal: "." | ",", amount: string | null) {
  const parts: string[] = [];
  let category: string | null = null;

  for (const [field, text] of record.fields) {
    if (field === "S") {
      category = text;
    } else if (field === "$" && category !== null) {
      const partAmount = parseAmount(text, decimal);
      // Split tags count in the row's direction, so an outgoing row's negative parts become positive tag amounts. An unreadable amount stays as written, so the row imports unsplit with the split text kept in its description.
      const signed = partAmount !== null && amount?.startsWith("-") ? negate(partAmount) : partAmount;
      const tagAmount = signed ?? text;

      parts.push(`${category.replaceAll(",", " ")}:${tagAmount}`);
      category = null;
    }
  }

  return parts.length > 0 ? parts.join(",") : null;
}
