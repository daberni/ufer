import { XMLParser, XMLValidator } from "fast-xml-parser";
import { negate, parseAmount } from "../csv-values";
import { cleanText, isoDate, lineAt, StatementFileError, StatementRows, type StatementFile } from "./statement-rows";

// Reads ISO 20022 bank-to-customer statements (camt.053, any version) into mapped rows: one row per booked entry, or per transaction of a batch entry whose transactions carry their own amounts.

type Node = Record<string, unknown>;

/** Whether the text is an ISO 20022 cash-management document; the message type decides whether it is supported. */
export function looksLikeCamt(text: string) {
  return /<(?:\w+:)?Document\b[^>]*urn:iso:std:iso:20022:tech:xsd:camt\./.test(text.slice(0, 4096));
}

export function readCamt053(text: string, locale: string): StatementFile {
  const namespace = /urn:iso:std:iso:20022:tech:xsd:(camt\.\d{3})/.exec(text.slice(0, 4096))?.[1];

  if (namespace !== "camt.053") {
    throw new StatementFileError(`${namespace ?? "This CAMT"} files are not supported; export a CAMT.053 account statement instead.`);
  }

  // Statements never declare entities; refusing a document type keeps entity expansion out of untrusted input.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new StatementFileError("The CAMT.053 file declares a document type, which statements never do.");
  }

  if (XMLValidator.validate(text) !== true) {
    throw new StatementFileError("The CAMT.053 file is not well-formed XML.");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true
  });
  const document = parser.parse(text) as Node;
  const statements = list(child(child(document, "Document"), "BkToCstmrStmt"), "Stmt");

  if (statements.length === 0) {
    throw new StatementFileError("The CAMT.053 file contains no statement.");
  }

  const rows = new StatementRows(locale);
  const positions = elementPositions(text);
  const lines = {
    offset: 0,
    line: 1
  };
  let entryIndex = 0;
  let detailIndex = 0;

  for (const statement of statements) {
    const account = child(statement, "Acct");
    const source = accountLabel(account);
    const accountCurrency = textOf(child(account, "Ccy")) || null;

    for (const entry of list(statement, "Ntry")) {
      const entryLine = lineAt(text, positions.entries[entryIndex++] ?? 0, lines);
      const details = list(child(entry, "NtryDtls"), "TxDtls");
      const detailLines = details.map(() => lineAt(text, positions.details[detailIndex++] ?? 0, lines));

      if (!booked(entry)) {
        continue;
      }

      const date = entryDate(entry);
      const entryCredit = textOf(child(entry, "CdtDbtInd")) === "CRDT";
      const entryReference = textOf(child(entry, "AcctSvcrRef")) || textOf(child(entry, "NtryRef"));
      // A batch entry lists its transactions with their own amounts; each becomes a row, so none is lost in a sum.
      const split = details.length > 1 && details.every(detail => amountNode(detail) !== null);

      if (split) {
        details.forEach((detail, index) => {
          const credit = textOf(child(detail, "CdtDbtInd")) ? textOf(child(detail, "CdtDbtInd")) === "CRDT" : entryCredit;
          const reference = textOf(child(child(detail, "Refs"), "AcctSvcrRef"));

          rows.add({
            line: detailLines[index],
            date,
            ...amountOf(amountNode(detail), credit, accountCurrency),
            payee: counterparty(detail, credit),
            description: remittance(detail) || cleanText(textOf(child(detail, "AddtlTxInf"))),
            category: null,
            source,
            id: reference || (entryReference ? `${entryReference}/${index + 1}` : null)
          });
        });

        continue;
      }

      const detail = details[0] ?? {};
      const reference = details.length === 1 ? textOf(child(child(detail, "Refs"), "AcctSvcrRef")) : "";

      rows.add({
        line: entryLine,
        date,
        ...amountOf(child(entry, "Amt"), entryCredit, accountCurrency),
        payee: counterparty(detail, entryCredit),
        description: remittance(detail) || cleanText(textOf(child(detail, "AddtlTxInf"))) || cleanText(textOf(child(entry, "AddtlNtryInf"))),
        category: null,
        source,
        id: entryReference || reference || null
      });
    }
  }

  return {
    format: "camt053",
    rows: rows.rows,
    errors: rows.errors
  };
}

function child(node: unknown, name: string): unknown {
  return node && typeof node === "object" ? (node as Node)[name] : undefined;
}

function list(node: unknown, name: string): Node[] {
  const value = child(node, name);

  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value]).filter((item): item is Node => Boolean(item) && typeof item === "object");
}

function textOf(node: unknown): string {
  if (typeof node === "string") {
    return node.trim();
  }

  if (node && typeof node === "object" && "#text" in node) {
    return String((node as Node)["#text"]).trim();
  }

  return "";
}

/** Older versions state the status as text, newer ones as a code. */
function booked(entry: Node) {
  const status = child(entry, "Sts");
  const code = textOf(child(status, "Cd")) || textOf(status);

  return code === "BOOK";
}

/** The value date, as bank syncs count bookings, else the booking date; either may be a date or a date-time. */
function entryDate(entry: Node) {
  for (const field of ["ValDt", "BookgDt"]) {
    const node = child(entry, field);
    const value = textOf(child(node, "Dt")) || textOf(child(node, "DtTm"));
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    if (match) {
      return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  return null;
}

/** A transaction's own amount: the plain amount, or the amount in the account's currency of its amount details. */
function amountNode(detail: Node): unknown {
  return child(detail, "Amt") ?? child(child(child(detail, "AmtDtls"), "TxAmt"), "Amt") ?? null;
}

function amountOf(node: unknown, credit: boolean, accountCurrency: string | null) {
  const value = textOf(node);
  const amount = /^\d{1,15}(\.\d{1,6})?$/.test(value) ? parseAmount(value, ".") : null;
  const currency = textOf(child(node, "@Ccy")) || accountCurrency;
  const signed = amount !== null && !credit ? negate(amount) : amount;

  return {
    amount: signed,
    currency
  };
}

/** The other party: the creditor of a debit, the debtor of a credit; the ultimate party when the direct one has no name. */
function counterparty(detail: Node, credit: boolean) {
  const parties = child(detail, "RltdPties");
  const names = credit ? ["Dbtr", "UltmtDbtr"] : ["Cdtr", "UltmtCdtr"];

  for (const name of names) {
    const party = child(parties, name);
    // From camt.053.001.08 the party sits inside a `Pty` element.
    const value = cleanText(textOf(child(child(party, "Pty"), "Nm")) || textOf(child(party, "Nm")));

    if (value) {
      return value;
    }
  }

  return "";
}

/** The unstructured remittance lines, joined. */
function remittance(detail: Node) {
  const lines = child(child(detail, "RmtInf"), "Ustrd");

  return cleanText((Array.isArray(lines) ? lines : [lines]).map(textOf).join(" "));
}

/** The statement's account: its IBAN, grouped in fours as banks print it, or another identification. */
function accountLabel(account: unknown) {
  const id = child(account, "Id");
  const iban = textOf(child(id, "IBAN")).replace(/\s+/g, "");

  if (iban) {
    return iban.replace(/(.{4})(?=.)/g, "$1 ");
  }

  return textOf(child(child(id, "Othr"), "Id"));
}

/** Character offsets of entry and transaction-detail start tags in document order, so rows point at their line in the file. */
function elementPositions(text: string) {
  const entries: number[] = [];
  const details: number[] = [];
  const tag = /<(?:\w+:)?(Ntry|TxDtls)[\s>]/g;

  for (const match of text.matchAll(tag)) {
    (match[1] === "Ntry" ? entries : details).push(match.index);
  }

  return {
    entries,
    details
  };
}
