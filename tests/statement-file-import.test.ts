import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { assignOccurrences, duplicateIdErrors, type MappedRow } from "../src/features/imports/import-rows";
import { readStatementFile, type StatementFile } from "../src/features/imports/statement-files";

// Synthetic statements only: names, IBANs and references are invented.

const now = Temporal.Instant.from("2026-06-30T12:00:00Z");

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>;
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;

  context.after(() => {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

  return db;
}

function read(text: string | Uint8Array) {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  const result = readStatementFile(bytes, "en");

  assert.ok(result && !("error" in result), `expected a statement, got ${JSON.stringify(result)}`);

  return result;
}

function readError(text: string) {
  const result = readStatementFile(new TextEncoder().encode(text), "en");

  assert.ok(result && "error" in result, `expected an error, got ${JSON.stringify(result)}`);

  return result.error;
}

const summary = (rows: MappedRow[]) => rows.map(row => [row.line, row.source, row.date, row.amount, row.currency, row.payee, row.description, row.id]);

const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>SYNTH-1</MsgId><CreDtTm>2026-03-02T08:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>S1</Id>
      <Acct><Id><IBAN>AT611904300234573201</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry>
        <Amt Ccy="EUR">1234.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-03-02</Dt></BookgDt>
        <ValDt><Dt>2026-02-28</Dt></ValDt>
        <AcctSvcrRef>REF-0001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties><Cdtr><Pty><Nm>Synthetic Landlord &amp; Co</Nm></Pty></Cdtr></RltdPties>
          <RmtInf><Ustrd>Rent March</Ustrd><Ustrd>Flat 3</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">2500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><DtTm>2026-03-01T09:15:00+01:00</DtTm></BookgDt>
        <AcctSvcrRef>REF-0002</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties><Dbtr><Pty><Nm>Example Employer GmbH</Nm></Pty></Dbtr></RltdPties>
          <RmtInf><Ustrd>Salary</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">9.99</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>PDNG</Cd></Sts>
        <BookgDt><Dt>2026-03-03</Dt></BookgDt>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">30.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-03-04</Dt></BookgDt>
        <AcctSvcrRef>BATCH-7</AcctSvcrRef>
        <NtryDtls>
          <TxDtls><Amt Ccy="EUR">10.00</Amt><RltdPties><Cdtr><Pty><Nm>Club A</Nm></Pty></Cdtr></RltdPties></TxDtls>
          <TxDtls><Amt Ccy="EUR">20.00</Amt><RltdPties><Cdtr><Pty><Nm>Club B</Nm></Pty></Cdtr></RltdPties></TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">abc</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-03-05</Dt></BookgDt>
      </Ntry>
    </Stmt>
    <Stmt>
      <Id>S2</Id>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id><Ccy>USD</Ccy></Acct>
      <Ntry>
        <Amt Ccy="USD">0.01</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-03-06</Dt></BookgDt>
        <NtryRef>N-1</NtryRef>
        <AddtlNtryInf>Interest</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;

test("CAMT.053 reads booked entries with signs, value dates, parties, batch transactions and several accounts", () => {
  const statement = read(camt);

  assert.equal(statement.format, "camt053");
  assert.deepEqual(summary(statement.rows), [
    [8, "AT61 1904 3002 3457 3201", "2026-02-28", "-1234.50", "EUR", "Synthetic Landlord & Co", "Rent March Flat 3", "REF-0001"],
    [20, "AT61 1904 3002 3457 3201", "2026-03-01", "2500.00", "EUR", "Example Employer GmbH", "Salary", "REF-0002"],
    [44, "AT61 1904 3002 3457 3201", "2026-03-04", "-10.00", "EUR", "Club A", "", null],
    [45, "AT61 1904 3002 3457 3201", "2026-03-04", "-20.00", "EUR", "Club B", "", null],
    [58, "DE89 3704 0044 0532 0130 00", "2026-03-06", "0.01", "USD", "", "Interest", "N-1"]
  ]);
  assert.deepEqual(statement.errors.map(error => error.line), [48]);
});

test("other CAMT messages, document types and malformed XML are refused with a reason", () => {
  assert.match(readError(camt.replace("camt.053.001.08", "camt.052.001.08")), /camt\.052 files are not supported/);
  assert.match(readError(camt.replace("<Document", "<!DOCTYPE x [<!ENTITY a \"b\">]><Document")), /document type/);
  assert.match(readError(camt.replace("</BkToCstmrStmt>", "")), /not well-formed/);
});

// OFX 1.x SGML: leaves without closing tags, Windows-1252 text, a decimal comma and a credit card statement next to a bank statement.
const ofxSgml = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260310</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS><TRNUID>1<STMTRS>
<CURDEF>EUR
<BANKACCTFROM><BANKID>12345<ACCTID>000111222<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301<DTEND>20260310
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305120000.000[+1:CET]<TRNAMT>-12,34<FITID>F-1<NAME>Café Zentral<MEMO>Frühstück &amp; Kaffee</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260306<DTUSER>20260304<TRNAMT>+100.00<FITID>F-2<PAYEE><NAME>Synthetic Refund Ltd</PAYEE></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260231<TRNAMT>-1.00<FITID>F-3<NAME>Bad date</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS>
</BANKMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>2<CCSTMTRS><CURDEF>EUR<CCACCTFROM><ACCTID>XXXX4242</CCACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260307<TRNAMT>-5.5<FITID>F-1<NAME>Bookshop<CURRENCY><CURRATE>1.1<CURSYM>GBP</CURRENCY></STMTTRN></BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>
`;

function windows1252(text: string) {
  return Uint8Array.from([...text].map(character => {
    const code = character.charCodeAt(0);

    assert.ok(code < 256);

    return code;
  }));
}

test("OFX 1.x SGML reads Windows-1252 text, entities, both signs, decimal commas, user dates and card statements", () => {
  const statement = read(windows1252(ofxSgml));

  assert.equal(statement.format, "ofx");
  assert.deepEqual(summary(statement.rows), [
    [14, "Bank 12345 · 000111222 · type CHECKING", "2026-03-05", "-12.34", "EUR", "Café Zentral", "Frühstück & Kaffee", "F-1"],
    [15, "Bank 12345 · 000111222 · type CHECKING", "2026-03-04", "100.00", "EUR", "Synthetic Refund Ltd", "", "F-2"],
    [21, "Card · XXXX4242", "2026-03-07", "-6.05", "EUR", "Bookshop", "GBP 5.5", "F-1"]
  ]);
  assert.deepEqual(statement.errors.map(error => error.line), [16]);
  // FITIDs are unique per account, so the same ID on the card account is no conflict.
  assert.deepEqual(duplicateIdErrors(statement.rows, source => source), []);
});

test("OFX 2.x XML reads closed elements and refuses investment statements", () => {
  const statement = read(`<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <CURDEF>CHF</CURDEF>
    <BANKACCTFROM><BANKID>1</BANKID><ACCTID>CH-SYNTH-1</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN><TRNTYPE>INT</TRNTYPE><DTPOSTED>20260131</DTPOSTED><TRNAMT>0.42</TRNAMT><FITID>X1</FITID><NAME>Interest</NAME><MEMO></MEMO></STMTTRN>
    </BANKTRANLIST>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`);

  assert.deepEqual(summary(statement.rows), [[8, "Bank 1 · CH-SYNTH-1 · type SAVINGS", "2026-01-31", "0.42", "CHF", "Interest", "", "X1"]]);
  assert.match(readError("OFXHEADER:100\n\n<OFX><INVSTMTMSGSRSV1></INVSTMTMSGSRSV1></OFX>"), /investment statements are not supported/);
  assert.match(readError("OFXHEADER:100\n\n<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>"), /no bank or credit card statement/);
});

const qif = `!Account
NSynthetic Giro
TBank
^
!Type:Bank
D31.01.2026
T-1.234,50
PSynthetic Landlord
MRent January
LHousing:Rent
^
D01.02.2026
T-60,00
PSupermarket
SFood:Groceries
$-45,52
SCar:Fuel
$-14,48
^
D02.02.2026
T-100,00
PSavings
L[Synthetic Savings]
^
D03.02.2026
T-10,00
PSplit gone wrong
SA
$-4,00
SB
$-5,00
^
D30.02.2026
T-1,00
PBad date
^
!Account
NSynthetic Cash
TCash
^
!Type:Cash
D04.02.2026
T-3,20
PBakery
`;

test("QIF detects day-first dates and decimal commas, keeps accounts, and reads categories, splits and transfers", () => {
  const statement = read(qif);

  assert.equal(statement.format, "qif");
  assert.deepEqual(statement.rows.map(row => [row.line, row.source, row.date, row.amount, row.payee, row.description, row.category, row.type, row.parts, row.id]), [
    [6, "Synthetic Giro", "2026-01-31", "-1234.50", "Synthetic Landlord", "Rent January", "Housing:Rent", null, null, null],
    [12, "Synthetic Giro", "2026-02-01", "-60.00", "Supermarket", "", null, null, [{
      category: "Food:Groceries",
      amount: "-45.52"
    }, {
      category: "Car:Fuel",
      amount: "-14.48"
    }], null],
    [20, "Synthetic Giro", "2026-02-02", "-100.00", "Savings", "", null, "transfer", null, null],
    // Parts that do not add up keep the row unsplit with its split text in the description.
    [25, "Synthetic Giro", "2026-02-03", "-10.00", "Split gone wrong", "Split: A 4.00, B 5.00", null, null, null, null],
    [42, "Synthetic Cash", "2026-02-04", "-3.20", "Bakery", "", null, null, null, null]
  ]);
  assert.deepEqual(statement.errors.map(error => error.line), [33]);
});

test("QIF reads US dates with apostrophe years and refuses investment accounts", () => {
  const statement = read("!Type:CCard\nD1/31'26\nT-1,234.56\nPStore\n^\nD12/1'25\nU20.00\nPRefund\n^\n");

  assert.deepEqual(statement.rows.map(row => [row.date, row.amount, row.source]), [["2026-01-31", "-1234.56", ""], ["2025-12-01", "20.00", ""]]);
  assert.match(readError("!Type:Invst\nD1/31'26\nNBuy\n^\n"), /investment accounts are not supported/);
});

test("QIF slash dates that never show the day follow Quicken's month-first order; a day above 12 settles it", () => {
  assert.deepEqual(read("!Type:Bank\nD1/2/2026\nT-1.00\n^\nD3/4/2026\nT-2.00\n^\n").rows.map(row => row.date), ["2026-01-02", "2026-03-04"]);
  assert.deepEqual(read("!Type:Bank\nD1/2/2026\nT-1.00\n^\nD25/4/2026\nT-2.00\n^\n").rows.map(row => row.date), ["2026-02-01", "2026-04-25"]);
});

test("QIF two-digit years take the most recent century that is not in the future, and unreadable split amounts stay in the description", () => {
  const statement = read("!Type:Bank\nD12/31'93\nT-1.00\n^\nD1/5/26\nT-60.00\nSFood\n$oops\nSCar\n$-14.48\n^\n");

  assert.deepEqual(statement.rows.map(row => [row.date, row.description, row.parts]), [["1993-12-31", "", null], ["2026-01-05", "Split: Food:oops, Car 14.48", null]]);
});

test("QIF transfers and categories drop a class suffix", () => {
  const statement = read("!Type:Bank\nD01.03.2026\nT-10,00\nL[Savings]/Household\n^\nD02.03.2026\nT-5,00\nLFood/Household\n^\n");

  assert.deepEqual(statement.rows.map(row => [row.type, row.category]), [["transfer", null], [null, "Food"]]);
});

test("CAMT batch details split only when they reconcile with the entry, across several NtryDtls", () => {
  const entry = (details: string) => camt.replace(/<Ntry>\s*<Amt Ccy="EUR">30\.00<\/Amt>[\s\S]*?<\/Ntry>/, `<Ntry><Amt Ccy="EUR">30.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-03-04</Dt></BookgDt><AcctSvcrRef>BATCH-7</AcctSvcrRef>${details}</Ntry>`);
  const batch = (rows: StatementFile["rows"]) => rows.filter(row => row.date === "2026-03-04").map(row => [row.amount, row.payee, row.id]);
  const detail = (amount: string, currency = "EUR") => `<TxDtls><Amt Ccy="${currency}">${amount}</Amt><RltdPties><Cdtr><Pty><Nm>Club ${amount}</Nm></Pty></Cdtr></RltdPties></TxDtls>`;

  assert.deepEqual(batch(read(entry(`<NtryDtls>${detail("10.00")}</NtryDtls><NtryDtls>${detail("20.00")}</NtryDtls>`)).rows), [["-10.00", "Club 10.00", null], ["-20.00", "Club 20.00", null]]);
  assert.deepEqual(batch(read(entry(`<NtryDtls>${detail("10.00")}${detail("25.00")}</NtryDtls>`)).rows), [["-30.00", "", "BATCH-7"]]);
  assert.deepEqual(batch(read(entry(`<NtryDtls>${detail("10.00", "USD")}${detail("20.00")}</NtryDtls>`)).rows), [["-30.00", "", "BATCH-7"]]);
});

test("OFX empty SGML leaves keep later fields, foreign amounts round exactly, and QIF split classes are dropped", () => {
  const ofx = read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>A1</BANKACCTFROM><BANKTRANLIST>\n<STMTTRN><DTPOSTED>20260301<TRNAMT>-1.005<NAME><MEMO>Payment<FITID>E-1<CURRENCY><CURRATE>3<CURSYM>JPY</CURRENCY></STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>");

  assert.deepEqual(ofx.rows.map(row => [row.amount, row.currency, row.payee, row.description, row.id]), [["-3.02", "EUR", "", "Payment · JPY 1.005", "E-1"]]);

  const toSavings = read("!Type:Bank\nD01.03.2026\nT-30,00\nS[Savings]\n$-20,00\nSFood\n$-10,00\n^\nD02.03.2026\nT-5,00\nS[Savings]\n$-5,00\n^\n");

  assert.deepEqual(toSavings.rows.map(row => [row.parts, row.category, row.type, row.description]), [[null, null, null, "Split: [Savings] 20.00, Food 10.00"], [null, null, "transfer", "Split: [Savings] 5.00"]]);
  assert.deepEqual(read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EURO<BANKACCTFROM><ACCTID>A</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1<FITID>1<CURRENCY><CURRATE>2<CURSYM>USD</CURRENCY></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>").errors.length, 1);

  const huf = read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>HUF<BANKACCTFROM><ACCTID>H</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-0.5<FITID>1<CURRENCY><CURRATE>3<CURSYM>EUR</CURRENCY></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>");

  // HUF keeps two decimals in Ufer although the runtime formats it with none.
  assert.equal(huf.rows[0].amount, "-1.50");

  const oneLine = read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>L</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1<FITID>1</STMTTRN><STMTTRN><DTPOSTED>20260231<TRNAMT>-2<FITID>2</STMTTRN><STMTTRN><DTPOSTED>20260302<TRNAMT>-3<FITID>3</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>");

  // Entries sharing a physical line are numbered in file order, so every row keeps its own decision.
  assert.deepEqual([oneLine.rows.map(row => row.line), oneLine.errors.map(error => error.line)], [[1, 3], [2]]);

  const missingAmount = read("!Type:Bank\nD01.03.2026\nT-10,00\nSFood\nSCar/Work\n$-4,00\nSHouse\n$-6,00\n^\n");

  assert.deepEqual([missingAmount.rows[0].parts, missingAmount.rows[0].description], [null, "Split: Food, Car 4.00, House 6.00"]);

  const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(camt.replace("UTF-8", "UTF-16"), character => [character.charCodeAt(0) & 0xff, character.charCodeAt(0) >> 8]).flat()]);

  assert.equal(read(utf16).rows.length, 5);
  // A single-byte encoding declared in the prolog decodes as declared.
  assert.equal(read(windows1252(camt.replace("UTF-8", "ISO-8859-1").replace("Synthetic Landlord", "S\u00fcd Landlord"))).rows[0].payee, "S\u00fcd Landlord & Co");

  const prefixed = camt.replace(/<(\/?)(?=[A-Z])/g, "<$1iso-doc.x:").replace("<iso-doc.x:Document xmlns=", "<iso-doc.x:Document xmlns:iso-doc.x=");

  assert.deepEqual(summary(read(prefixed).rows), summary(read(camt).rows));

  const ofxTransaction = (inner: string) => read(`OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>F</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-10.00<FITID>1${inner}</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);

  assert.deepEqual([ofxTransaction("<TRNTYPE>XFER").rows[0].type, ofxTransaction("<TRNTYPE>DEBIT").rows[0].type], ["transfer", null]);
  assert.equal(ofxTransaction("<CURRENCY><CURRATE>2</CURRENCY>").errors.length, 1);
  assert.equal(ofxTransaction("<MEMO><![CDATA[Coffee & <lunch>]]></MEMO>").rows[0].description, "Coffee & <lunch>");
  assert.equal(ofxTransaction("</STMTTRN><!-- <STMTTRN><DTPOSTED>20260302<TRNAMT>-99<FITID>X</STMTTRN> --><STMTTRN><DTPOSTED>20260303<TRNAMT>-1<FITID>2").rows.length, 2);
  assert.deepEqual(read(camt.replace("<Ntry>", "<!-- <Ntry></Ntry> -->\n<Ntry>")).rows.map(row => row.line).slice(0, 2), [9, 21]);
  assert.equal(ofxTransaction("<CURRENCY><CURRATE>1<CURSYM>GBP</CURRENCY>").rows[0].description, "GBP 10.00");

  const multiTarget = read("!Type:Bank\nD01.03.2026\nT-10,00\nS[Savings]\n$-5,00\nS[Brokerage]\n$-5,00\n^\nD02.03.2026\nT-10,00\nS[Savings]\n$-4,00\nS[Savings]\n$-6,00\n^\n");

  assert.deepEqual(multiTarget.rows.map(row => row.type), [null, "transfer"]);
  assert.equal(read("!Type:Bank\nD01.03.2026\nT-10,00\nS[Savings]\n$-4,00\nS[Savings]\n$-5,00\n^\n").rows[0].type, null);
  assert.deepEqual([read("!Type:Bank\nD01.03.2026\nT-10,00\nMLunch\nSFood\n$-10,00\n^\n").rows[0]].map(row => [row.category, row.parts, row.description]), [["Food", null, "Lunch"]]);
  assert.equal(read("<?xml version=\"1.0\"?>\n<!-- exported -->\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>C</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1<FITID>1</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>").rows.length, 1);

  const noDirection = read(camt.replace("<CdtDbtInd>CRDT</CdtDbtInd>", "<CdtDbtInd>XXXX</CdtDbtInd>"));

  assert.deepEqual([noDirection.rows.length, noDirection.errors.map(error => error.line)], [4, [20, 48]]);

  const commaSplit = read("!Type:Bank\nD01.03.2026\nT-10,00\nSFood, Dining\n$-4,00\nSCar\n$-6,00\n^\n");

  assert.deepEqual(commaSplit.rows[0].parts?.map(part => part.category), ["Food, Dining", "Car"]);

  const other = (id: string, scheme: string) => `<Acct><Id><Othr><Id>${id}</Id><SchmeNm><Cd>${scheme}</Cd></SchmeNm><Issr>Synthetic Bank</Issr></Othr></Id><Ccy>EUR</Ccy></Acct>`;
  const schemes = read(camt.replace(/<Acct>[\s\S]*?<\/Acct>/, other("123", "BBAN")).replace(/<Acct><Id><IBAN>DE89[\s\S]*?<\/Acct>/, other("123", "CUID")));

  assert.deepEqual([...new Set(schemes.rows.map(row => row.source))], ["123 · scheme BBAN · issuer Synthetic Bank", "123 · scheme CUID · issuer Synthetic Bank"]);

  const shared = read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><BANKID>B1<ACCTID>42</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1<FITID>1</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<CCACCTFROM><ACCTID>42</CCACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-2<FITID>1</STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>");

  assert.deepEqual(shared.rows.map(row => row.source), ["Bank B1 · 42", "Card · 42"]);

  const branches = read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1>" + ["N", "S"].map(branch => `<STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><BANKID>B1<BRANCHID>${branch}<ACCTID>42<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1<FITID>1</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS>`).join("") + "</BANKMSGSRSV1></OFX>");

  assert.deepEqual(branches.rows.map(row => row.source), ["Bank B1 · branch N · 42 · type CHECKING", "Bank B1 · branch S · 42 · type CHECKING"]);

  // Accounts omitting different optional fields keep distinct sources.
  const omitted = read("OFXHEADER:100\n\n<OFX><BANKMSGSRSV1>" + ["<BANKID>B<BRANCHID>123<ACCTID>SAVINGS<ACCTTYPE>CHECKING", "<BANKID>B<ACCTID>123<ACCTTYPE>SAVINGS<ACCTKEY>CHECKING"].map(identity => `<STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM>${identity}</BANKACCTFROM><BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1<FITID>1</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS>`).join("") + "</BANKMSGSRSV1></OFX>");

  assert.equal(new Set(omitted.rows.map(row => row.source)).size, 2);

  const qifSplit = read("!Type:Bank\nD01.03.2026\nT-3,00\nMWeekly\nSFood/Household\nEBread\n$-1,00\nSCar/Work\nEParking\n$-2,00\n^\n");

  assert.deepEqual(qifSplit.rows[0].parts?.map(part => part.category), ["Food", "Car"]);
  assert.equal(qifSplit.rows[0].description, "Weekly · Bread · Parking");
});

test("CSV and other text are not taken for statements", () => {
  assert.equal(readStatementFile(new TextEncoder().encode("Date,Amount\n2026-01-01,1.00\n"), "en"), null);
  assert.equal(readStatementFile(new TextEncoder().encode("<?xml version=\"1.0\"?><Other/>"), "en"), null);
});

async function importStatement(statement: StatementFile, importId: string, targets: {
  source: string;
  account_id?: string;
  new_account?: {
    name: string;
    kind: string;
    currency: string;
  };
}[]) {
  const rows = assignOccurrences(statement.rows, source => source);

  return importMappedRows({
    import_id: importId,
    rows,
    targets,
    confirm: true
  }, now);
}

test("reimporting a CAMT.053 file finds every row by its bank reference and adds nothing", async context => {
  const db = await isolatedDatabase(context);
  const statement = read(camt);
  const first = await importStatement(statement, "00000000-0000-4000-8000-000000000313", [{
    source: "AT61 1904 3002 3457 3201",
    new_account: {
      name: "Synthetic Giro",
      kind: "checking",
      currency: "EUR"
    }
  }, {
    source: "DE89 3704 0044 0532 0130 00",
    new_account: {
      name: "Synthetic Dollar",
      kind: "checking",
      currency: "USD"
    }
  }]);

  assert.equal(first.newRows, 5);

  const accounts = await db.select().from(schema.accounts);
  const idOf = (name: string) => accounts.find(account => account.name === name)!.id;
  const transactions = await db.select().from(schema.transactions);

  assert.deepEqual(transactions.map(row => row.amount_minor).sort((a, b) => a - b), [-123450, -2000, -1000, 1, 250000]);

  // A later import of the same file, under a new import, into the accounts the first one created.
  const again = await importStatement(statement, "00000000-0000-4000-8000-000000000314", [{
    source: "AT61 1904 3002 3457 3201",
    account_id: idOf("Synthetic Giro")
  }, {
    source: "DE89 3704 0044 0532 0130 00",
    account_id: idOf("Synthetic Dollar")
  }]);

  assert.equal(again.newRows, 0);
  assert.deepEqual(again.duplicates.map(duplicate => duplicate.reason), Array(5).fill("already_imported"));
  assert.equal((await db.select().from(schema.transactions)).length, 5);

  // A later export lists the batch's transactions in another order; without their own references they still match by content.
  const reordered = read(camt.replace(/(<TxDtls><Amt Ccy="EUR">10\.00<\/Amt>.*?<\/TxDtls>)(\s*)(<TxDtls><Amt Ccy="EUR">20\.00<\/Amt>.*?<\/TxDtls>)/, "$3$2$1"));

  assert.deepEqual(reordered.rows.filter(row => row.date === "2026-03-04").map(row => row.payee), ["Club B", "Club A"]);

  const reorderedAgain = await importStatement(reordered, "00000000-0000-4000-8000-000000000317", [{
    source: "AT61 1904 3002 3457 3201",
    account_id: idOf("Synthetic Giro")
  }, {
    source: "DE89 3704 0044 0532 0130 00",
    account_id: idOf("Synthetic Dollar")
  }]);

  assert.equal(reorderedAgain.newRows, 0);
  assert.equal(reorderedAgain.updatedRows, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 5);
});

test("reimporting a QIF file without IDs finds its rows by content, including identical rows", async context => {
  const db = await isolatedDatabase(context);
  const statement = read("!Type:Bank\nD01.03.2026\nT-2,50\nPCoffee\n^\nD01.03.2026\nT-2,50\nPCoffee\n^\nD02.03.2026\nT-60,00\nPSupermarket\nSFood\n$-45,52\nSCar\n$-14,48\n^\n");
  const target = [{
    source: "",
    new_account: {
      name: "Synthetic Wallet",
      kind: "checking",
      currency: "EUR"
    }
  }];
  const first = await importStatement(statement, "00000000-0000-4000-8000-000000000315", target);

  assert.equal(first.newRows, 3);
  assert.equal((await db.select().from(schema.transactionSplits)).length, 2);

  const account = (await db.select().from(schema.accounts))[0];
  const again = await importStatement(statement, "00000000-0000-4000-8000-000000000316", [{
    source: "",
    account_id: account.id
  }]);

  assert.equal(again.newRows, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 3);
  assert.equal((await db.select().from(schema.transactionSplits)).length, 2);
});


test("OFX XFER transactions import as transfers and pair across the file's accounts", async context => {
  const db = await isolatedDatabase(context);
  const statement = (account: string, amount: string) => `<STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>${account}</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>XFER<DTPOSTED>20260301<TRNAMT>${amount}<FITID>T-${account}<NAME>Own transfer</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS>`;
  const file = read(`OFXHEADER:100\n\n<OFX><BANKMSGSRSV1>${statement("A", "-50.00")}${statement("B", "50.00")}</BANKMSGSRSV1></OFX>`);
  const newAccount = (source: string) => ({
    source,
    new_account: {
      name: `Synthetic ${source}`,
      kind: "checking",
      currency: "EUR"
    }
  });

  await importStatement(file, "00000000-0000-4000-8000-000000000318", [newAccount("A"), newAccount("B")]);

  const transactions = await db.select().from(schema.transactions);

  assert.deepEqual(transactions.map(row => row.type), ["transfer", "transfer"]);
  assert.ok(transactions[0].transfer_id);
  assert.equal(transactions[0].transfer_id, transactions[1].transfer_id);
});
