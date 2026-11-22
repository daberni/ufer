import { twoDigitYear, detectDateFormat, detectDecimal, type DateFormat, fractionDigits, negate, parseAmount, parseDate, signedScaled } from "../csv-values";
import { maxCategoryLength, type SplitPartRow } from "../import-rows";
import { maximumSplitParts } from "@/features/transactions/split-limits";
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
    // A `/class` suffix tags the transaction with a class, which Ufer has no counterpart for.
    const category = value(record, "L").split("/")[0].trim();
    // `[Account]` names a transfer to another account in Quicken, not a category.
    const transfer = /^\[.*\]$/.test(category);
    const splits = splitLines(record, decimal);
    // A split part that moves money to another account (`S[Savings]`) has no place in a categorized split; the row stays unsplit and keeps the split text.
    const splitTargets = record.fields.filter(([field]) => field === "S").map(([, text]) => /^\[.*\]$/.test(text.split("/")[0].trim()));
    const splitTransfer = splitTargets.some(Boolean);
    const parts = splits && amount !== null && !transfer && !splitTransfer ? splitParts(splits, amount) : null;
    // Split memos have no place on a split part, so they join the description.
    const splitMemos = record.fields.filter(([field, text]) => field === "E" && text).map(([, text]) => cleanText(text));
    const memo = [cleanText(value(record, "M")), ...splitMemos].filter(Boolean).join(" · ");
    const description = splits && !parts ? [memo, splitText(splits, amount)].filter(Boolean).join(" · ") : memo;

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
      // Pairing links a transfer to one booking of its full amount, so only a split moving everything to one account is a transfer.
      type: transfer || singleSplitTarget(record) ? "transfer" : null,
      parts,
      // Kept for the server, which appends the split text when it cannot take the split.
      tags: parts && splits ? splitText(splits, amount).slice("Split: ".length) : null
    });
  });

  return {
    format: "qif",
    ...rows.result()
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

function singleSplitTarget(record: QifRecord) {
  const targets = record.fields.filter(([field]) => field === "S").map(([, text]) => text.split("/")[0].trim());

  return targets.length > 0 && targets.every(target => /^\[.*\]$/.test(target)) && new Set(targets).size === 1;
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

type QifSplitLine = {
  category: string;
  /** The signed part amount; null when unreadable, with `text` as written, or missing. */
  amount: string | null;
  text: string | null;
};

/** A split transaction's `S` category and `$` amount pairs in file order, read without a delimiter so category names keep their commas; null without splits. */
function splitLines(record: QifRecord, decimal: "." | ","): QifSplitLine[] | null {
  const lines: QifSplitLine[] = [];
  let category: string | null = null;

  for (const [field, text] of record.fields) {
    if (field === "S") {
      // A category without its amount stays without one, which makes the split invalid and keeps its text.
      if (category !== null) {
        lines.push({
          category,
          amount: null,
          text: null
        });
      }

      category = text.split("/")[0].trim();
    } else if (field === "$" && category !== null) {
      lines.push({
        category,
        amount: parseAmount(text, decimal),
        text
      });
      category = null;
    }
  }

  if (category !== null) {
    lines.push({
      category,
      amount: null,
      text: null
    });
  }

  return lines.length > 0 ? lines : null;
}

/** The parts of a valid split, which add up exactly to the row's amount; null when the split lines form none. */
function splitParts(lines: QifSplitLine[], amount: string): SplitPartRow[] | null {
  const valid = lines.length >= 2 && lines.length <= maximumSplitParts && lines.every(line => line.amount !== null && line.category && line.category.length <= maxCategoryLength);

  if (!valid) {
    return null;
  }

  const parts = lines.map(line => ({
    category: line.category,
    amount: line.amount!
  }));
  const scale = Math.max(fractionDigits(amount), ...parts.map(part => fractionDigits(part.amount)));

  if (parts.some(part => signedScaled(part.amount, scale) === 0n)) {
    return null;
  }

  const total = parts.reduce((sum, part) => sum + signedScaled(part.amount, scale), 0n);

  return total === signedScaled(amount, scale) ? parts : null;
}

/** The split lines as text, with amounts in the row's direction: `Split: Food, Dining 4.00, Car 6.00`. */
function splitText(lines: QifSplitLine[], amount: string | null) {
  const outgoing = amount?.startsWith("-") ?? false;
  const listed = lines.map(line => {
    if (line.amount !== null) {
      return `${line.category} ${outgoing ? negate(line.amount) : line.amount}`;
    }

    return line.text === null ? line.category : `${line.category}:${line.text}`;
  });

  return `Split: ${listed.join(", ")}`;
}
