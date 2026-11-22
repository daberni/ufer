import { formatScaled, fractionDigits, parseAmount, signedScaled } from "../csv-values";
import { cleanText, isoDate, lineAt, StatementFileError, StatementRows, type StatementFile } from "./statement-rows";

// Reads OFX and QFX bank and credit-card statements, both SGML (1.x, closing tags optional) and XML (2.x), into mapped rows.

/** An OFX element: an aggregate with children, or a leaf with a value. */
type Element = {
  name: string;
  value: string | null;
  children: Element[];
  line: number;
};

/** Whether the text is an OFX file: an SGML header or an XML processing instruction, followed by the OFX root. */
export function looksLikeOfx(text: string) {
  const head = text.slice(0, 4096);

  return /^\s*OFXHEADER\s*:/.test(head) || /<\?OFX\b/i.test(head) || /^\s*(?:<\?xml[^>]*>\s*)?<OFX>/i.test(head);
}

export function readOfx(text: string, locale: string): StatementFile {
  const root = parseOfx(text);
  const messages = root.children;

  if (find(messages, "INVSTMTMSGSRSV1")) {
    throw new StatementFileError("OFX investment statements are not supported; export a bank or credit card statement instead.");
  }

  const statements = [
    ...all(find(messages, "BANKMSGSRSV1"), "STMTTRNRS").map(response => ({
      statement: find(response?.children ?? [], "STMTRS"),
      account: "BANKACCTFROM"
    })),
    ...all(find(messages, "CREDITCARDMSGSRSV1"), "CCSTMTTRNRS").map(response => ({
      statement: find(response?.children ?? [], "CCSTMTRS"),
      account: "CCACCTFROM"
    }))
  ];

  if (statements.length === 0) {
    throw new StatementFileError("The OFX file contains no bank or credit card statement.");
  }

  const rows = new StatementRows(locale);

  for (const {
    statement,
    account
  } of statements) {
    if (!statement) {
      continue;
    }

    const currency = leaf(statement, "CURDEF").toUpperCase() || null;
    const source = leaf(find(statement.children, account), "ACCTID");

    for (const transaction of all(find(statement.children, "BANKTRANLIST"), "STMTTRN")) {
      // A transaction in another currency states its amount in that currency with the rate to the statement's; the row keeps the account's currency and notes the original amount.
      const foreign = find(transaction.children, "CURRENCY");
      const trnamt = ofxAmount(leaf(transaction, "TRNAMT"));
      const ownCurrency = leaf(foreign, "CURSYM").toUpperCase();
      const converted = foreign && currency && ownCurrency !== currency ? convert(trnamt, leaf(foreign, "CURRATE"), currency) : trnamt;
      const note = converted !== trnamt && trnamt !== null ? `${ownCurrency} ${trnamt.replace("-", "")}` : "";
      const payee = leaf(transaction, "NAME") || leaf(find(transaction.children, "PAYEE"), "NAME");

      rows.add({
        line: transaction.line,
        // The date the person made the transaction, as bank syncs count bookings, else the posting date.
        date: ofxDate(leaf(transaction, "DTUSER") || leaf(transaction, "DTPOSTED")),
        amount: converted,
        currency,
        payee: cleanText(payee),
        description: [cleanText(leaf(transaction, "MEMO")), note].filter(Boolean).join(" · "),
        category: null,
        source,
        id: leaf(transaction, "FITID") || null
      });
    }
  }

  return {
    format: "ofx",
    rows: rows.rows,
    errors: rows.errors
  };
}

/** The `YYYYMMDD` start of an OFX date-time; the time and time zone do not move the calendar date the bank reported. */
function ofxDate(value: string) {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value);

  return match ? isoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** An amount times a rate in the account currency's minor units, rounded half away from zero with exact integers; null without a valid rate. */
function convert(amount: string | null, rate: string, currency: string) {
  if (amount === null || !/^\d{1,9}(?:\.\d{1,10})?$/.test(rate) || !/[1-9]/.test(rate)) {
    return null;
  }

  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const amountScale = fractionDigits(amount);
  const rateScale = fractionDigits(rate);
  const product = signedScaled(amount, amountScale) * signedScaled(rate, rateScale);
  const excess = amountScale + rateScale - digits;

  if (excess <= 0) {
    return formatScaled(product * 10n ** BigInt(-excess), digits);
  }

  const divisor = 10n ** BigInt(excess);
  const magnitude = product < 0n ? -product : product;
  const rounded = (magnitude + divisor / 2n) / divisor;

  return formatScaled(product < 0n ? -rounded : rounded, digits);
}

/** OFX amounts are signed decimals with a point; some banks write a decimal comma, never with grouping. */
function ofxAmount(value: string) {
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(value)) {
    return null;
  }

  return parseAmount(value.replace(/^\+/, ""), value.includes(",") ? "," : ".");
}

function find(elements: Element[] | undefined, name: string) {
  return elements?.find(element => element.name === name);
}

function all(element: Element | undefined, name: string) {
  return element?.children.filter(child => child.name === name) ?? [];
}

function leaf(element: Element | undefined, name: string) {
  return find(element?.children, name)?.value?.trim() ?? "";
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);

      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }

    return entities[name.toLowerCase()] ?? whole;
  });
}

// Aggregates the reader relies on; an empty element of another name is an aggregate only when it is closed later.
const aggregates = new Set(["OFX", "SIGNONMSGSRSV1", "SONRS", "STATUS", "FI", "BANKMSGSRSV1", "STMTTRNRS", "STMTRS", "BANKACCTFROM", "BANKACCTTO", "BANKTRANLIST", "STMTTRN", "PAYEE", "CURRENCY", "ORIGCURRENCY", "LEDGERBAL", "AVAILBAL", "CREDITCARDMSGSRSV1", "CCSTMTTRNRS", "CCSTMTRS", "CCACCTFROM", "CCACCTTO", "INVSTMTMSGSRSV1"]);

const leaves = new Set(["NAME", "MEMO", "TRNAMT", "FITID", "DTPOSTED", "DTUSER", "TRNTYPE", "CURDEF", "ACCTID", "BANKID", "ACCTTYPE", "CURSYM", "CURRATE", "CHECKNUM", "REFNUM", "SIC", "PAYEEID"]);

function opensAggregate(name: string, text: string, from: number) {
  if (aggregates.has(name)) {
    return true;
  }

  if (leaves.has(name)) {
    return false;
  }

  return new RegExp(`</${name}\\s*>`, "i").test(text.slice(from));
}

/**
 * Parses the body from the `<OFX>` root into a tree. A tag followed by text is a leaf, whose closing tag is optional in SGML; any other tag opens an aggregate, which its closing tag ends, closing any leaves and aggregates left open inside it.
 */
function parseOfx(text: string): Element {
  const start = text.search(/<OFX>/i);

  if (start < 0) {
    throw new StatementFileError("The OFX file has no OFX element.");
  }

  const root: Element = {
    name: "ROOT",
    value: null,
    children: [],
    line: 1
  };
  const stack: Element[] = [root];
  const lines = {
    offset: 0,
    line: 1
  };
  const tag = /<(\/?)([A-Za-z0-9_.]+)\s*>([^<]*)/g;

  tag.lastIndex = start;

  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    const [, closing, rawName, rawText] = match;
    const name = rawName.toUpperCase();
    const value = rawText.trim();

    if (closing) {
      const open = stack.findLastIndex(element => element.name === name);

      // A closing tag for a leaf that already ended, or a stray one, closes nothing.
      if (open > 0) {
        stack.length = open;
      }

      continue;
    }

    const element: Element = {
      name,
      value: value ? decodeEntities(value) : null,
      children: [],
      line: lineAt(text, match.index, lines)
    };

    stack[stack.length - 1].children.push(element);

    if (!value && opensAggregate(name, text, tag.lastIndex)) {
      stack.push(element);
    }
  }

  const ofx = find(root.children, "OFX");

  if (!ofx) {
    throw new StatementFileError("The OFX file has no OFX element.");
  }

  return ofx;
}
