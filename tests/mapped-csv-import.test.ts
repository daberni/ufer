import assert from "node:assert/strict";
import { z } from "zod";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient, type InArgs, type InStatement } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { archiveAccount, restoreAccount } from "../src/features/accounts/server/account-service";
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { saveMappedEntries } from "../src/features/imports/server/mapped-import-repository";
import { ValidationError } from "../src/lib/errors";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { hideTransaction } from "../src/features/transactions/server/transaction-service";
import { findDuplicates } from "../src/features/imports/server/duplicate-matching";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { startSyncRun } from "../src/features/banking/server/sync-repository";
import { accountLabel, categoryValues, defaultCategorySelection, defaultTargetChoice, importKey, newAccountChoice, prepareImport, type TargetChoice } from "../src/features/imports/import-plan";
import { assignOccurrences, batchRows, currencyAllows, maxCategoryChoicesPerRequest, duplicateIdErrors, importIdFor, maxTargetsPerRequest, readCsvTable, emptyMapping, mappingProblem, normalizeText, parseCsvRecords, pruneConsumed, decodeCsv, detectDateFormat, detectDecimal, detectDelimiter, mapRows, parseAmount, parseCsv, parseDate, suggestMapping, type CsvSettings, type DateFormat, type ImportRow } from "../src/features/imports/csv-mapping";

const now = Temporal.Instant.from("2026-06-30T12:00:00Z");

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
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

function mappedRow(line: number, date: string, amount: string, payee: string, extra: Partial<ImportRow> = {}): ImportRow {
  return {
    line,
    date,
    amount,
    currency: "EUR",
    payee,
    description: "",
    category: null,
    source: "",
    occurrence: 0,
    id: null,
    transfer: false,
    ...extra
  };
}

const importId = "00000000-0000-4000-8000-000000000187";

async function manualAccount(name: string) {
  const id = `synthetic-${name.toLowerCase().replaceAll(" ", "-")}`;
  const db = await (globalThis as unknown as {
    budgetDb: Promise<Database>
  }).budgetDb;

  await db.insert(schema.accounts).values({
    id,
    environment: "SANDBOX",
    name,
    institution: "Example institution",
    kind: "checking"
  });

  return {
    id
  };
}

async function insertBankAccount(db: Database) {
  await db.insert(schema.accounts).values({
    id: "synthetic-bank-account",
    environment: "SANDBOX",
    name: "Synthetic bank account",
    institution: "Example bank",
    kind: "checking",
    provider: "enablebanking",
    balance_minor: 123_456,
    balance_date: "2026-06-29"
  });
}

test("parses German semicolon exports with decimal commas and a Windows-1252 encoding", () => {
  const csv = "Buchungsdatum;Empfänger;Verwendungszweck;Betrag\n02.01.2024;Bäckerei Müller;\"Brot; Gebäck\";-1.234,50\n03.01.2024;Arbeitgeber;Gehalt;2.500,00\n";
  const bytes = Uint8Array.from([...csv].map(character => character.charCodeAt(0)));
  const decoded = decodeCsv(bytes);

  assert.equal(decoded.encoding, "windows-1252");

  const delimiter = detectDelimiter(decoded.text);
  const [header, ...rows] = parseCsv(decoded.text, delimiter);
  const settings: CsvSettings = {
    encoding: decoded.encoding,
    delimiter,
    decimal: detectDecimal(rows.map(row => row[3])),
    dateFormat: detectDateFormat(rows.map(row => row[0]))
  };
  const result = mapRows(rows, suggestMapping(header), settings);

  assert.deepEqual(settings, {
    encoding: "windows-1252",
    delimiter: ";",
    decimal: ",",
    dateFormat: "DD.MM.YYYY"
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(row => [row.line, row.date, row.amount, row.payee, row.description]), [
    [2, "2024-01-02", "-1234.50", "Bäckerei Müller", "Brot; Gebäck"],
    [3, "2024-01-03", "2500.00", "Arbeitgeber", "Gehalt"]
  ]);
});

test("reads UTF-8 with a byte order mark, debit and credit columns, and reports bad rows by line", () => {
  const csv = "﻿Date,Payee,Debit,Credit\n2024-03-01,Shop,12.30,\n2024-02-30,Shop,1.00,\n2024-03-02,Refund,,4.5\n2024-03-03,Nothing,,\n";
  const decoded = decodeCsv(new TextEncoder().encode(csv));
  const [header, ...rows] = parseCsv(decoded.text, detectDelimiter(decoded.text));
  const result = mapRows(rows, suggestMapping(header), {
    encoding: decoded.encoding,
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.equal(decoded.encoding, "utf-8");
  assert.equal(header[0], "Date");
  assert.deepEqual(result.rows.map(row => [row.line, row.amount]), [[2, "-12.30"], [4, "4.5"]]);
  assert.deepEqual(result.errors.map(error => error.line), [3, 5]);
});

test("amount and date variants", () => {
  assert.equal(parseAmount("(1,234.56)", "."), "-1234.56");
  assert.equal(parseAmount("12,50-", ","), "-12.50");
  assert.equal(parseAmount("€ 1 000,00", ","), "1000.00");
  assert.equal(parseAmount("1.234", "."), "1.234");
  assert.equal(parseAmount("abc", "."), null);
  assert.equal(parseDate("12/31/2023", "MM/DD/YYYY"), "2023-12-31");
  assert.equal(parseDate("31.12.23", "DD.MM.YY"), "2023-12-31");
  assert.equal(parseDate("2024-01-05 10:22:00", "YYYY-MM-DD"), "2024-01-05");
  assert.equal(detectDateFormat(["31/01/2024", "01/02/2024"]), "DD/MM/YYYY");
  assert.equal(detectDateFormat(["02.01.2023", "31.02.2023"]), "DD.MM.YYYY");
  assert.equal(detectDecimal(["-12,50", "3,00"]), ",");
});

test("identical rows in one file stay distinct through their occurrence", () => {
  const result = mapRows([["2024-01-01", "-5.00", "Coffee"], ["2024-01-01", "-5.00", "Coffee"]], {
    date: 0,
    amount: 1,
    debit: null,
    credit: null,
    payee: 2,
    description: null,
    currency: null,
    category: null,
    account: null,
    id: null,
    type: null
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.deepEqual(assignOccurrences(result.rows, () => "account").map(row => row.occurrence), [0, 1]);
});

test("duplicate matching tolerates date shifts and text variants but consumes each existing booking once", () => {
  const existing = [{
    reference: "bank:1",
    date: "2024-01-03",
    amount: -1250,
    counterparty: "BILLA DANKT 1234",
    description: "Card payment"
  }];
  const candidate = (date: string, amount: number, counterparty: string) => ({
    reference: `csv:${date}:${counterparty}`,
    date,
    amount,
    counterparty,
    description: ""
  });

  assert.deepEqual([...findDuplicates([candidate("2024-01-01", -1250, "Billa")], existing).duplicates.keys()], [0]);
  assert.deepEqual([...findDuplicates([candidate("2023-12-30", -1250, "Billa")], existing).duplicates.keys()], []);
  assert.deepEqual([...findDuplicates([candidate("2024-01-01", -1251, "Billa")], existing).duplicates.keys()], []);
  assert.deepEqual([...findDuplicates([candidate("2024-01-01", -1250, "Spar")], existing).duplicates.keys()], []);
  assert.deepEqual([...findDuplicates([candidate("2024-01-01", -1250, "Billa"), candidate("2024-01-02", -1250, "Billa")], existing).duplicates.keys()], [0]);
});

test("checking persists nothing; confirming saves new rows once and is idempotent", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Closed account");
  const payload = {
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop"), mappedRow(3, "2024-01-01", "-10.00", "Shop", {
      occurrence: 1
    }), mappedRow(4, "2027-01-01", "1.00", "Future"), mappedRow(5, "2024-01-02", "1.00", "Dollar", {
      currency: "USD"
    })],
    targets: [{
      source: "",
      account_id: account.id
    }]
  };
  const checked = await importMappedRows({
    import_id: importId,
    ...payload,
    confirm: false
  }, now);

  assert.equal(checked.newRows, 2);
  assert.deepEqual(checked.errors.map(error => error.line), [4, 5]);
  assert.equal((await db.select().from(schema.transactions)).length, 0);

  const confirmed = await importMappedRows({
    import_id: importId,
    ...payload,
    confirm: true
  }, now);
  const again = await importMappedRows({
    import_id: importId,
    ...payload,
    confirm: true
  }, now);

  assert.equal(confirmed.newRows, 2);
  assert.equal(again.newRows, 0);
  assert.deepEqual(again.duplicates.map(duplicate => [duplicate.line, duplicate.reason]), [[2, "already_imported"], [3, "already_imported"]]);
  assert.equal((await db.select().from(schema.transactions)).length, 2);
  assert.equal((await listAccounts()).find(item => item.id === account.id)?.balance_minor, -2000);
});

test("new accounts are created once per import, on confirmation, across batches and retries", async context => {
  const db = await isolatedDatabase(context);
  const target = [{
    source: "",
    new_account: {
      name: "Closed account",
      kind: "checking",
      currency: "EUR"
    }
  }];
  const checked = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop")],
    targets: target,
    confirm: false
  }, now);

  assert.equal(checked.newRows, 1);
  assert.equal((await db.select().from(schema.accounts)).length, 0);

  const first = {
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop")],
    targets: target,
    confirm: true
  };

  await importMappedRows(first, now);
  // A retry of the same batch after a lost response, then the next batch.
  await importMappedRows(first, now);
  await importMappedRows({
    ...first,
    rows: [mappedRow(3, "2024-01-02", "-20.00", "Market")]
  }, now);

  const accounts = await db.select().from(schema.accounts);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].name, "Closed account");
  assert.equal((await db.select().from(schema.transactions)).length, 2);
});

test("a later batch never treats rows saved by an earlier batch of the file as duplicates, so check and confirm agree", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("History");
  const batches = [[mappedRow(2, "2024-03-01", "-9.99", "Streaming service")], [mappedRow(3, "2024-03-02", "-9.99", "Streaming service")]];
  const run = async (confirm: boolean) => {
    let newRows = 0;
    let consumed: {
      account_id: string;
      reference: string;
    }[] = [];

    for (const rows of batches) {
      const result = await importMappedRows({
        import_id: importId,
        rows,
        targets: [{
          source: "",
          account_id: account.id
        }],
        consumed,
        confirm
      }, now);

      newRows += result.newRows;
      consumed = [...consumed, ...result.matched];
    }

    return newRows;
  };

  assert.equal(await run(false), 2);
  assert.equal(await run(true), 2);
  assert.equal((await db.select().from(schema.transactions)).length, 2);
});

test("an existing booking matched by one batch is not matched again by the next", async context => {
  const db = await isolatedDatabase(context);

  await insertBankAccount(db);
  await db.insert(schema.transactions).values({
    id: "synced-1",
    account_id: "synthetic-bank-account",
    provider_reference: "bank:synced-1",
    booking_date: "2024-05-03",
    amount_minor: -500,
    currency: "EUR",
    counterparty: "Coffee bar",
    description: "",
    type: "expense"
  });

  const request = (line: number, date: string, consumed: unknown[]) => importMappedRows({
    import_id: importId,
    rows: [mappedRow(line, date, "-5.00", "Coffee bar")],
    targets: [{
      source: "",
      account_id: "synthetic-bank-account"
    }],
    consumed,
    confirm: false
  }, now);
  const first = await request(2, "2024-05-03", []);
  const second = await request(3, "2024-05-04", first.matched);

  assert.deepEqual(first.duplicates.map(duplicate => duplicate.line), [2]);
  assert.equal(second.newRows, 1);
});

test("imports into a bank-linked account skip synced bookings and leave the bank balance unchanged", async context => {
  const db = await isolatedDatabase(context);

  await insertBankAccount(db);
  await db.insert(schema.transactions).values({
    id: "synced-1",
    account_id: "synthetic-bank-account",
    provider_reference: "bank:synced-1",
    booking_date: "2024-05-03",
    amount_minor: -4599,
    currency: "EUR",
    counterparty: "Example Grocer GmbH",
    description: "Card payment",
    type: "expense"
  });

  const result = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-05-02", "-45.99", "EXAMPLE GROCER"), mappedRow(3, "2024-04-01", "-20.00", "Older history")],
    targets: [{
      source: "",
      account_id: "synthetic-bank-account"
    }],
    confirm: true
  }, now);
  const account = (await listAccounts()).find(item => item.id === "synthetic-bank-account");

  assert.equal(result.newRows, 1);
  assert.deepEqual(result.duplicates, [{
    line: 2,
    reason: "existing_booking"
  }]);
  assert.equal((await db.select().from(schema.transactions)).length, 2);
  assert.equal(account?.balance_minor, 123_456);
  assert.equal(account?.balance_date, "2026-06-29");
});

test("CSV categories map by name, rules categorize the rest, and existing categories are never overwritten", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("History");

  await db.insert(schema.categories).values([{
    id: "synthetic-groceries",
    name: "Synthetic groceries",
    color: "#00aa00"
  }, {
    id: "synthetic-travel",
    name: "Synthetic travel",
    color: "#0000aa"
  }]);
  await insertRule({
    id: "synthetic-rule-train",
    name: "Train",
    pattern: "railway",
    mode: "keyword",
    category_id: "synthetic-travel",
    priority: 100,
    enabled: true
  });
  await db.insert(schema.transactions).values({
    id: "earlier",
    account_id: account.id,
    provider_reference: "manual:earlier",
    booking_date: "2024-02-01",
    amount_minor: -800,
    currency: "EUR",
    counterparty: "Corner shop",
    description: "",
    category_id: "synthetic-travel",
    category_source: "manual",
    type: "expense"
  });

  const result = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-02-01", "-8.00", "Corner shop", {
      category: "synthetic groceries"
    }), mappedRow(3, "2024-02-05", "-30.00", "Market", {
      category: "SYNTHETIC GROCERIES"
    }), mappedRow(4, "2024-02-06", "-55.00", "National Railway", {
      category: "Unknown things"
    })],
    targets: [{
      source: "",
      account_id: account.id
    }],
    confirm: true
  }, now);
  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, account.id)).orderBy(schema.transactions.booking_date);

  assert.deepEqual(result.unknownCategories, ["Unknown things"]);
  assert.deepEqual(rows.map(row => [row.counterparty, row.category_id, row.category_source]), [
    ["Corner shop", "synthetic-travel", "manual"],
    ["Market", "synthetic-groceries", "manual"],
    ["National Railway", "synthetic-travel", "rule"]
  ]);
});

test("rows route to targets by their source account column", async context => {
  const db = await isolatedDatabase(context);
  const first = await manualAccount("First");
  const second = await manualAccount("Second");
  const result = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-1.00", "A", {
      source: "Wallet"
    }), mappedRow(3, "2024-01-01", "-2.00", "B", {
      source: "Card"
    }), mappedRow(4, "2024-01-01", "-3.00", "C", {
      source: "Unmapped"
    })],
    targets: [{
      source: "Wallet",
      account_id: first.id
    }, {
      source: "Card",
      account_id: second.id
    }],
    confirm: true
  }, now);

  assert.equal(result.newRows, 2);
  assert.deepEqual(result.errors.map(error => error.line), [4]);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, second.id))).length, 1);
});

test("text matching keeps Unicode letters, and texts without letters or digits never match", () => {
  const booking = (counterparty: string) => ({
    reference: "bank:1",
    date: "2024-01-01",
    amount: -100,
    counterparty,
    description: ""
  });
  const candidate = (counterparty: string) => ({
    ...booking(counterparty),
    reference: "csv:m:1"
  });

  assert.equal(normalizeText("Café Ä-Straße"), "cafe a straße");
  assert.deepEqual([...findDuplicates([candidate("Привет магазин")], [booking("Ресторан Мир")]).duplicates.keys()], []);
  assert.deepEqual([...findDuplicates([candidate("Привет магазин")], [booking("магазин 12")]).duplicates.keys()], [0]);
  assert.deepEqual([...findDuplicates([candidate("***")], [booking("Shop")]).duplicates.keys()], []);
});

test("occurrences count rows with equal canonical amounts and normalized texts", () => {
  const result = mapRows([["2024-01-01", "-5.5", "Coffee!"], ["2024-01-01", "-5.50", "coffee"]], {
    date: 0,
    amount: 1,
    debit: null,
    credit: null,
    payee: 2,
    description: null,
    currency: null,
    category: null,
    account: null,
    id: null,
    type: null
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.deepEqual(assignOccurrences(result.rows, () => "account").map(row => row.occurrence), [0, 1]);
});

test("a same-date booking wins; several window candidates are only possible duplicates", () => {
  const booking = (reference: string, date: string) => ({
    reference,
    date,
    amount: -700,
    counterparty: "Bakery",
    description: ""
  });
  const candidate = {
    reference: "csv:m:1",
    date: "2024-01-10",
    amount: -700,
    counterparty: "Bakery",
    description: ""
  };
  const sameDate = findDuplicates([candidate], [booking("bank:a", "2024-01-09"), booking("bank:b", "2024-01-10")]);
  const ambiguous = findDuplicates([candidate], [booking("bank:a", "2024-01-09"), booking("bank:b", "2024-01-11")]);
  const single = findDuplicates([candidate], [booking("bank:a", "2024-01-12")]);

  assert.deepEqual(sameDate.matched.map(booking => booking.reference), ["bank:b"]);
  assert.deepEqual([...ambiguous.duplicates.keys()], []);
  assert.deepEqual(ambiguous.possible, [0]);
  assert.deepEqual(single.matched.map(booking => booking.reference), ["bank:a"]);
});

test("a later bank sync adopts the matching CSV-imported row with its category instead of inserting a duplicate", async context => {
  const db = await isolatedDatabase(context);

  await insertBankAccount(db);
  await db.insert(schema.categories).values({
    id: "synthetic-dining",
    name: "Synthetic dining",
    color: "#aa0000"
  });
  await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-06-01", "-18.40", "Example Bistro", {
      category: "Synthetic dining"
    }), mappedRow(3, "2024-06-02", "-3.00", "Kiosk")],
    targets: [{
      source: "",
      account_id: "synthetic-bank-account"
    }],
    confirm: true
  }, now);
  await startSyncRun(db, "SANDBOX", "adopt", "2026-06-30T08:00:00.000Z");

  const inserted = await saveAccountSync(db, {
    environment: "SANDBOX",
    startedAt: "2026-06-30T08:00:00.000Z"
  }, "synthetic-bank-account", "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "1234.56",
      currency: "EUR"
    },
    reference_date: "2026-06-29"
  }], [{
    reference: "bank:bistro",
    date: "2024-06-01",
    amount: -1840,
    currency: "EUR",
    counterparty: "EXAMPLE BISTRO VIENNA",
    description: "Card payment"
  }, {
    reference: "bank:other",
    date: "2024-06-03",
    amount: -900,
    currency: "EUR",
    counterparty: "Pharmacy",
    description: ""
  }], []);
  const rows = await db.select().from(schema.transactions).orderBy(schema.transactions.booking_date);

  assert.equal(inserted, 1);
  assert.deepEqual(rows.map(row => [row.provider_reference.startsWith("csv:") ? "csv" : row.provider_reference, row.counterparty, row.category_id]), [
    ["bank:bistro", "EXAMPLE BISTRO VIENNA", "synthetic-dining"],
    ["csv", "Kiosk", null],
    ["bank:other", "Pharmacy", null]
  ]);
});

test("consumed matches stay bounded for files with more than 20,000 matched bookings", async context => {
  await isolatedDatabase(context);

  const account = await manualAccount("Long history");
  const start = Date.UTC(1990, 0, 1);
  const consumed = Array.from({
    length: 25_000
  }, (_value, index) => ({
    account_id: account.id,
    reference: `bank:${index}`,
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10)
  }));
  const lastDate = consumed[consumed.length - 1].date;
  const pruned = pruneConsumed(consumed, lastDate);
  const result = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, lastDate, "-1.00", "Shop")],
    targets: [{
      source: "",
      account_id: account.id
    }],
    consumed: pruned,
    confirm: false
  }, Temporal.Instant.from("2060-01-01T00:00:00Z"));

  assert.deepEqual(pruned.map(booking => booking.reference), ["bank:24996", "bank:24997", "bank:24998", "bank:24999"]);
  assert.equal(result.newRows, 1);
});

test("saving rechecks duplicates in its write transaction, so bookings synced after the check are not duplicated", async context => {
  const db = await isolatedDatabase(context);

  await insertBankAccount(db);

  // The check ran before this booking arrived from the bank.
  await db.insert(schema.transactions).values({
    id: "synced-late",
    account_id: "synthetic-bank-account",
    provider_reference: "bank:late",
    booking_date: "2024-07-01",
    amount_minor: -2500,
    currency: "EUR",
    counterparty: "Example Hardware",
    description: "",
    type: "expense"
  });

  const {
    inserted
  } = await saveMappedEntries("synthetic-bank-account", [{
    reference: "csv:m:late",
    date: "2024-07-01",
    amount: -2500,
    currency: "EUR",
    counterparty: "EXAMPLE HARDWARE STORE",
    description: "",
    categoryId: null,
    categorySource: "rule",
    categoryRuleId: null,
    ruleType: null,
    typeRuleId: null,
    typeTransferAccountId: null,
    transfer: false
  }], null);

  assert.equal(inserted, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 1);
});

test("check and confirm agree when a duplicate row consumes a booking a later row of the batch could also match", async context => {
  const db = await isolatedDatabase(context);

  await insertBankAccount(db);
  await db.insert(schema.transactions).values({
    id: "synced-cafe",
    account_id: "synthetic-bank-account",
    provider_reference: "bank:cafe",
    booking_date: "2024-08-02",
    amount_minor: -1000,
    currency: "EUR",
    counterparty: "Example Cafe",
    description: "",
    type: "expense"
  });

  const payload = (confirm: boolean) => ({
    import_id: importId,
    rows: [mappedRow(2, "2024-08-02", "-10.00", "Example Cafe"), mappedRow(3, "2024-08-04", "-10.00", "Example Cafe")],
    targets: [{
      source: "",
      account_id: "synthetic-bank-account"
    }],
    confirm
  });
  const checked = await importMappedRows(payload(false), now);
  const confirmed = await importMappedRows(payload(true), now);

  assert.equal(checked.newRows, 1);
  assert.equal(confirmed.newRows, 1);
  assert.deepEqual(confirmed.duplicates.map(duplicate => duplicate.line), [2]);
});

test("amounts accept currency symbols and codes but reject other letters", () => {
  assert.equal(parseAmount("1e3", "."), null);
  assert.equal(parseAmount("12abc", "."), null);
  assert.equal(parseAmount("EUR -12,50", ","), "-12.50");
  assert.equal(parseAmount("-€1.234,50", ","), "-1234.50");
  assert.equal(parseAmount("(€1,234.56)", "."), "-1234.56");
  assert.equal(parseAmount("12.00 usd", "."), "12.00");
  assert.equal(parseAmount("12,50 €", ","), "12.50");
  assert.equal(parseAmount("1€2", "."), null);
  assert.equal(parseAmount("USD €10", "."), null);
  assert.equal(parseAmount("€10 EUR", "."), null);

  const result = mapRows([["2024-01-01", "12.00 USD", "Shop"], ["2024-01-02", "1e3", "Shop"], ["2024-01-03", "5 GBP", "Shop", "EUR"]], {
    date: 0,
    amount: 1,
    debit: null,
    credit: null,
    payee: 2,
    description: null,
    currency: 3,
    category: null,
    account: null,
    id: null,
    type: null
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.deepEqual(result.rows.map(row => [row.line, row.currency]), [[2, "USD"]]);
  assert.deepEqual(result.errors.map(error => error.line), [3, 4]);
});

test("a retry uses the account an earlier batch created and rejects a conflicting configuration", async context => {
  const db = await isolatedDatabase(context);
  const target = (currency: string, kind = "checking") => [{
    source: "",
    new_account: {
      name: "Closed account",
      kind,
      currency
    }
  }];

  await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop")],
    targets: target("EUR"),
    confirm: true
  }, now);

  const rechecked = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop")],
    targets: target("EUR"),
    confirm: false
  }, now);

  assert.equal(rechecked.newRows, 0);
  await assert.rejects(importMappedRows({
    import_id: importId,
    rows: [mappedRow(3, "2024-01-02", "-5.00", "Shop", {
      currency: null
    })],
    targets: target("USD"),
    confirm: true
  }, now), ValidationError);
  await assert.rejects(importMappedRows({
    import_id: importId,
    rows: [mappedRow(3, "2024-01-02", "-5.00", "Shop")],
    targets: target("EUR", "savings"),
    confirm: true
  }, now), ValidationError);
  assert.equal((await db.select().from(schema.accounts)).length, 1);
  assert.equal((await db.select().from(schema.transactions)).length, 1);
});

const plainMapping = {
  date: 0,
  amount: 1,
  debit: null,
  credit: null,
  payee: 2,
  description: null,
  currency: null,
  category: null,
  account: 3,
  id: null,
  type: null
};

const isoSettings: CsvSettings = {
  encoding: "utf-8",
  delimiter: ",",
  decimal: ".",
  dateFormat: "YYYY-MM-DD"
};

test("occurrences count per target account, independent of order and other accounts in the export", () => {
  const rows = [["2024-01-01", "-5.00", "Coffee", "Card"], ["2024-01-01", "-5.00", "Coffee", "Wallet"], ["2024-01-01", "-5.00", "Coffee", "Wallet"]];
  const target = (source: string) => source;
  const full = assignOccurrences(mapRows(rows, plainMapping, isoSettings).rows, target);
  const reordered = assignOccurrences(mapRows([rows[2], rows[0], rows[1]], plainMapping, isoSettings).rows, target);
  const walletOnly = assignOccurrences(mapRows([rows[1], rows[2]], plainMapping, isoSettings).rows, target);
  const occurrences = (items: ImportRow[], source: string) => items.filter(row => row.source === source).map(row => row.occurrence).sort();

  assert.deepEqual(occurrences(full, "Wallet"), [0, 1]);
  assert.deepEqual(occurrences(full, "Card"), [0]);
  assert.deepEqual(occurrences(reordered, "Wallet"), [0, 1]);
  assert.deepEqual(occurrences(walletOnly, "Wallet"), [0, 1]);
});

test("debit and credit columns with conflicting currencies are row errors", () => {
  const mapping = {
    ...plainMapping,
    amount: null,
    debit: 1,
    credit: 4,
    currency: 5
  };
  const result = mapRows([["2024-01-01", "5 USD", "Shop", "", "1 EUR", ""], ["2024-01-02", "5 EUR", "Shop", "", "", "USD"], ["2024-01-03", "5 EUR", "Shop", "", "1 EUR", "EUR"]], mapping, isoSettings);

  assert.deepEqual(result.errors.map(error => error.line), [2, 3]);
  assert.deepEqual(result.rows.map(row => [row.amount, row.currency]), [["-4", "EUR"]]);
});

test("amount parsing is exact, bounded and rejects ambiguous input", () => {
  const cases: [string, "." | ",", string | null][] = [
    ["-12.50", ".", "-12.50"],
    ["+12.50", ".", "12.50"],
    ["12.50-", ".", "-12.50"],
    ["(12.50)", ".", "-12.50"],
    ["(-12.50)", ".", null],
    ["(10", ".", null],
    ["10)", ".", null],
    ["(10)", ".", "-10"],
    ["-12.50-", ".", null],
    ["--5", ".", null],
    ["1,234,567.89", ".", "1234567.89"],
    ["1.234.567,89", ",", "1234567.89"],
    ["1,234", ".", "1234"],
    ["1,234", ",", "1.234"],
    ["1,23,456", ".", null],
    ["1\u00a0234,50", ",", "1234.50"],
    ["1\u202f234,50", ",", "1234.50"],
    ["1'234.50", ".", "1234.50"],
    ["0", ".", "0"],
    ["-0.00", ".", "0.00"],
    ["", ".", null],
    ["-", ".", null],
    ["()", ".", null],
    [".5", ".", null],
    ["1.1234567", ".", null],
    ["1.123456", ".", "1.123456"],
    ["1234567890123456", ".", null],
    ["123456789012345", ".", "123456789012345"],
    ["9".repeat(100), ".", null],
    ["1e3", ".", null]
  ];

  for (const [input, decimal, expected] of cases) {
    assert.equal(parseAmount(input, decimal), expected, `${input} with ${decimal}`);
  }
});

test("debit and credit combine exactly, including large values and both columns filled", () => {
  const mapping = {
    ...plainMapping,
    amount: null,
    debit: 1,
    credit: 4
  };
  const result = mapRows([["2024-01-01", "0.1", "A", "", "0.2"], ["2024-01-02", "", "B", "", "123456789012345.67"], ["2024-01-03", "-10.005", "C", "", ""], ["2024-01-04", "", "D", "", ""], ["2024-01-05", "0", "E", "", ""]], mapping, isoSettings);

  assert.deepEqual(result.rows.map(row => row.amount), ["0.1", "123456789012345.67", "-10.005", "0"]);
  assert.deepEqual(result.errors.map(error => error.line), [5]);
});

test("dates reject impossible days and map two-digit years to the most recent past century", () => {
  const nextYear = (new Date().getUTCFullYear() + 1) % 100;
  const cases: [string, DateFormat, string | null][] = [
    ["2024-02-29", "YYYY-MM-DD", "2024-02-29"],
    ["2023-02-29", "YYYY-MM-DD", null],
    ["30.02.2024", "DD.MM.YYYY", null],
    ["31.04.2024", "DD.MM.YYYY", null],
    ["00.01.2024", "DD.MM.YYYY", null],
    ["01.13.2024", "DD.MM.YYYY", null],
    ["05.06.07", "DD.MM.YY", "2007-06-05"],
    [`01.01.${String(nextYear).padStart(2, "0")}`, "DD.MM.YY", `19${String(nextYear).padStart(2, "0")}-01-01`],
    ["2024-01-05T10:00:00", "YYYY-MM-DD", "2024-01-05"],
    ["", "YYYY-MM-DD", null]
  ];

  for (const [input, format, expected] of cases) {
    assert.equal(parseDate(input, format), expected, input);
  }
});

test("CSV records keep quoted delimiters, line breaks and quotes, and report physical line numbers", () => {
  const text = "\ufeffDate,Payee,Amount\r\n2024-01-01,\"Shop, Inc.\",-1.00\r\n\r\n2024-01-02,\"Two\nlines\",-2.00\n2024-01-03,5\" screen,-3.00\n2024-01-04,\"He said \"\"hi\"\"\",-4.00";
  const decoded = decodeCsv(new TextEncoder().encode(text));
  const records = parseCsvRecords(decoded.text, ",");

  assert.deepEqual(records.map(record => record.line), [1, 2, 4, 6, 7]);
  assert.deepEqual(records.map(record => record.cells[1]), ["Payee", "Shop, Inc.", "Two\nlines", "5\" screen", "He said \"hi\""]);

  const result = mapRows(records.slice(1).map(record => record.cells), {
    ...plainMapping,
    amount: 2,
    payee: 1,
    account: null,
    id: null,
    type: null
  }, isoSettings, records.slice(1).map(record => record.line));

  assert.deepEqual(result.rows.map(row => row.line), [2, 4, 6, 7]);
});

test("references stay stable when the export reorders rows", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Stable");
  const rows = [["2024-01-01", "-5.00", "Coffee", ""], ["2024-01-02", "-7.00", "Bakery", ""], ["2024-01-01", "-5.00", "Coffee", ""]];
  const run = async (order: string[][], confirm: boolean) => importMappedRows({
    import_id: importId,
    rows: assignOccurrences(mapRows(order, plainMapping, isoSettings).rows, () => account.id),
    targets: [{
      source: "",
      account_id: account.id
    }],
    confirm
  }, now);

  await run(rows, true);

  const again = await run([rows[2], rows[1], rows[0]], false);

  assert.equal(again.newRows, 0);
  assert.equal((await db.select().from(schema.transactions)).length, 3);
});

test("scientific notation is a row error that explains the likely spreadsheet export", () => {
  const result = mapRows([["2024-01-01", "1.5E+03", "Shop", ""]], plainMapping, isoSettings);

  assert.match(result.errors[0]?.message ?? "", /Scientific notation is not supported/);
});

test("a bank entry repeated in one response adopts only one CSV-imported row", async context => {
  const db = await isolatedDatabase(context);

  await insertBankAccount(db);
  await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-06-01", "-18.40", "Example Bistro"), mappedRow(3, "2024-06-01", "-18.40", "Example Bistro", {
      occurrence: 1
    })],
    targets: [{
      source: "",
      account_id: "synthetic-bank-account"
    }],
    confirm: true
  }, now);
  await startSyncRun(db, "SANDBOX", "repeat", "2026-06-30T08:00:00.000Z");

  const booking = {
    reference: "bank:bistro",
    date: "2024-06-01",
    amount: -1840,
    currency: "EUR",
    counterparty: "EXAMPLE BISTRO",
    description: ""
  };

  await saveAccountSync(db, {
    environment: "SANDBOX",
    startedAt: "2026-06-30T08:00:00.000Z"
  }, "synthetic-bank-account", "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "100.00",
      currency: "EUR"
    },
    reference_date: "2026-06-29"
  }], [booking, {
    ...booking
  }], []);
  const rows = await db.select().from(schema.transactions);

  assert.deepEqual(rows.map(row => row.provider_reference.startsWith("csv:") ? "csv" : row.provider_reference).sort(), ["bank:bistro", "csv"]);
});

test("a row the target rejects for its currency does not shift the occurrences of accepted rows", () => {
  const row = {
    line: 2,
    date: "2026-03-01",
    amount: "-10.00",
    payee: "Example Shop",
    description: "Purchase",
    category: null,
    source: "",
    id: null,
    transfer: false
  };
  const rows = assignOccurrences([{
    ...row,
    currency: "EUR"
  }, {
    ...row,
    line: 3,
    currency: "USD"
  }], () => "account", () => "USD");

  assert.equal(rows[1].occurrence, 0);
});

test("identical rows stated as USD, $ and blank import as distinct transactions into a USD account", async context => {
  const db = await isolatedDatabase(context);
  const rows = assignOccurrences([mappedRow(2, "2024-01-01", "-10.00", "Shop", {
    currency: "USD"
  }), mappedRow(3, "2024-01-01", "-10.00", "Shop", {
    currency: "$"
  }), mappedRow(4, "2024-01-01", "-10.00", "Shop", {
    currency: null
  })], () => "new:", () => "USD");
  const confirmed = await importMappedRows({
    import_id: importId,
    rows,
    targets: [{
      source: "",
      new_account: {
        name: "Dollar account",
        kind: "checking",
        currency: "USD"
      }
    }],
    confirm: true
  }, now);

  assert.equal(confirmed.newRows, 3);
  assert.equal((await db.select().from(schema.transactions)).length, 3);
});

test("space and apostrophe thousands separators must form groups of three", () => {
  assert.equal(parseAmount("1'23", "."), null);
  assert.equal(parseAmount("12 34", ","), null);
  assert.equal(parseAmount("1'2'3", "."), null);
  assert.equal(parseAmount("1'234.56", "."), "1234.56");
  assert.equal(parseAmount("1 234,56", ","), "1234.56");
  assert.equal(parseAmount("-1 234 567,89", ","), "-1234567.89");
  assert.equal(parseAmount("- 12,50", ","), "-12.50");
  assert.equal(parseAmount("1\n234", "."), null);
  assert.equal(parseAmount("1\t234", "."), null);
  assert.equal(parseAmount("1 234'567", "."), null);
  assert.equal(parseAmount("1'234 567", "."), null);
  assert.equal(parseAmount("1'234'567.5", "."), "1234567.5");
  assert.equal(parseAmount("1\u00A0234,56", ","), "1234.56");
});

test("the same column cannot be both debit and credit", () => {
  const mapping = {
    date: 0,
    amount: null,
    debit: 1,
    credit: 1,
    payee: 2,
    description: null,
    currency: null,
    category: null,
    account: null,
    id: null,
    type: null
  };

  assert.notEqual(mappingProblem(mapping), null);
  assert.equal(mappingProblem({
    ...mapping,
    credit: 3
  }), null);
});

test("an ambiguous currency symbol is rejected for an account outside its currencies", async context => {
  await isolatedDatabase(context);
  const account = await manualAccount("Euro account");
  const result = mapRows([["2024-01-01", "$10.00", "Shop"], ["2024-01-02", "¥500", "Shop"]], {
    date: 0,
    amount: 1,
    debit: null,
    credit: null,
    payee: 2,
    description: null,
    currency: null,
    category: null,
    account: null,
    id: null,
    type: null
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });
  const checked = await importMappedRows({
    import_id: importId,
    rows: assignOccurrences(result.rows, () => "account"),
    targets: [{
      source: "",
      account_id: account.id
    }],
    confirm: false
  }, now);

  assert.equal(checked.newRows, 0);
  assert.deepEqual(checked.errors.map(error => error.line), [2, 3]);
  assert.equal(currencyAllows("$", "USD"), true);
  assert.equal(currencyAllows("¥", "JPY"), true);
  assert.equal(currencyAllows("$", "EUR"), false);
  assert.equal(currencyAllows("$", "XCD"), true);
  assert.equal(currencyAllows("$", "BMD"), true);
  assert.equal(currencyAllows("¥", "CNY"), true);
  assert.equal(currencyAllows("¥", "KRW"), false);
});

test("CSV categories match canonically equivalent spellings of a stored name", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Wallet");

  await db.insert(schema.categories).values({
    id: "synthetic-cafe",
    name: "Synthetic Café",
    color: "#00aa00"
  });

  const result = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-03-01", "-4.20", "Espresso bar", {
      category: "synthetic café"
    })],
    targets: [{
      source: "",
      account_id: account.id
    }],
    confirm: true
  }, now);
  const rows = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, account.id));

  assert.deepEqual(result.unknownCategories, []);
  assert.deepEqual(rows.map(row => [row.category_id, row.category_source]), [["synthetic-cafe", "manual"]]);
});

test("a mapping uses either a signed amount or debit and credit, never both", () => {
  const suggested = suggestMapping(["Date", "Payee", "Amount", "Debit", "Credit"]);

  assert.equal(suggested.amount, 2);
  assert.equal(suggested.debit, null);
  assert.equal(suggested.credit, null);
  assert.equal(mappingProblem(suggested), null);
  assert.match(mappingProblem({
    ...suggested,
    debit: 3
  }) ?? "", /not both/);
});

test("rows with an export ID are recognized by it on reimport even when their content changed", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Identified history");
  const targets = [{
    source: "",
    account_id: account.id
  }];

  await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-04-01", "-12.00", "Bakery", {
      id: "tx-1"
    }), mappedRow(3, "2024-04-01", "-12.00", "Bakery", {
      id: "tx-2"
    })],
    targets,
    confirm: true
  }, now);

  const reimport = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-04-01", "-12.00", "Bakery (corrected text)", {
      id: "tx-1"
    }), mappedRow(3, "2024-04-02", "-5.00", "Kiosk", {
      id: "tx-3"
    })],
    targets,
    confirm: true
  }, now);

  assert.deepEqual(reimport.duplicates.map(duplicate => [duplicate.line, duplicate.reason]), [[2, "already_imported"]]);
  assert.equal(reimport.newRows, 1);
  assert.equal((await db.select().from(schema.transactions)).length, 3);
});

test("an ID repeated for the same account rejects every row that carries it", async context => {
  await isolatedDatabase(context);
  const account = await manualAccount("Identified history");
  const rows = [mappedRow(2, "2024-04-01", "-1.00", "A", {
    id: "same"
  }), mappedRow(3, "2024-04-02", "-2.00", "B", {
    id: "same"
  }), mappedRow(4, "2024-04-03", "-3.00", "C", {
    id: "other"
  })];
  const checked = await importMappedRows({
    import_id: importId,
    rows,
    targets: [{
      source: "",
      account_id: account.id
    }],
    confirm: false
  }, now);

  assert.deepEqual(checked.errors.map(error => error.line), [2, 3]);
  assert.equal(checked.newRows, 1);
  assert.deepEqual(duplicateIdErrors(rows, () => account.id).map(error => error.line), [2, 3]);
  assert.deepEqual(duplicateIdErrors(rows, source => source).map(error => error.line), [2, 3]);
});

test("a mapped but empty ID cell is a row error", () => {
  const result = mapRows([["2024-01-01", "1.00", "Shop", ""], ["2024-01-02", "2.00", "Shop", "tx-9"]], {
    ...emptyMapping,
    date: 0,
    amount: 1,
    payee: 2,
    id: 3
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.deepEqual(result.errors.map(error => error.line), [2]);
  assert.deepEqual(result.rows.map(row => row.id), ["tx-9"]);
});

for (const [kind, amount, expected] of [["current", "100.00", 13000], ["start", "50.00", 5000]] as const) {
  test(`a new account's ${kind} balance books its opening balance on the file's first date across batches`, async context => {
    const db = await isolatedDatabase(context);
    const base = {
      import_id: importId,
      targets: [{
        source: "",
        new_account: {
          name: "Imported wallet",
          kind: "checking",
          currency: "EUR",
          opening: {
            kind,
            amount,
            date: "2024-05-01"
          }
        }
      }],
      confirm: true
    };

    await importMappedRows({
      ...base,
      rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop")]
    }, now);
    await importMappedRows({
      ...base,
      rows: [mappedRow(3, "2024-05-02", "-20.00", "Market")]
    }, now);
    // A retried batch changes nothing.
    await importMappedRows({
      ...base,
      rows: [mappedRow(3, "2024-05-02", "-20.00", "Market")]
    }, now);

    const bookings = await db.select().from(schema.transactions);
    const openings = bookings.filter(booking => booking.type === "opening_balance");

    assert.equal(bookings.length, 3);
    assert.deepEqual(openings.map(booking => [booking.booking_date, booking.amount_minor]), [["2024-05-01", expected]]);
    assert.equal((await listAccounts()).find(item => item.name === "Imported wallet")?.balance_minor, expected - 3000);
  });
}

test("category choices assign existing categories, create missing ones on confirmation, and leave rule rows to the rules", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Categorized history");

  await db.insert(schema.categories).values({
    id: "synthetic-food",
    name: "Synthetic food",
    color: "#00aa00"
  });

  const payload = {
    import_id: importId,
    rows: [mappedRow(2, "2024-06-01", "-1.00", "A", {
      category: "Lebensmittel"
    }), mappedRow(3, "2024-06-02", "-2.00", "B", {
      category: "Hobby"
    }), mappedRow(4, "2024-06-03", "-3.00", "C", {
      category: "Food, Travel"
    })],
    targets: [{
      source: "",
      account_id: account.id
    }],
    categories: [{
      value: "Lebensmittel",
      action: "existing",
      category_id: "synthetic-food"
    }, {
      value: "Hobby",
      action: "create"
    }, {
      value: "Food, Travel",
      action: "rules"
    }]
  };
  const before = (await db.select().from(schema.categories)).length;
  const checked = await importMappedRows({
    ...payload,
    confirm: false
  }, now);

  assert.deepEqual([checked.createdCategories, checked.unknownCategories], [["Hobby"], []]);
  assert.equal((await db.select().from(schema.categories)).length, before);

  await importMappedRows({
    ...payload,
    confirm: true
  }, now);

  const hobby = (await db.select().from(schema.categories)).find(category => category.name === "Hobby");
  const assigned = new Map((await db.select().from(schema.transactions)).map(booking => [booking.counterparty, booking.category_id]));

  assert.ok(hobby);
  assert.deepEqual([assigned.get("A"), assigned.get("B"), assigned.get("C")], ["synthetic-food", hobby.id, null]);
});

test("skipped source accounts leave their rows out, and a new account's opening balance is dated on its first row", () => {
  const rows = [mappedRow(2, "2024-07-03", "-1.00", "A", {
    source: "Wallet"
  }), mappedRow(3, "2024-07-01", "-2.00", "B", {
    source: "Wallet"
  }), mappedRow(4, "2024-06-01", "-3.00", "C", {
    source: "Old card"
  })];
  const choices = new Map<string, TargetChoice>([["Wallet", {
    kind: "new",
    name: "Wallet",
    accountKind: "savings",
    currency: "EUR",
    balanceKind: "current",
    balance: "1.234,50"
  }], ["Old card", {
    kind: "skip"
  }]]);
  const prepared = prepareImport(rows, choices, [], new Map(), ",");

  assert.deepEqual(prepared.rows.map(row => row.line), [2, 3]);
  assert.equal(prepared.skipped, 1);
  assert.deepEqual(prepared.problems, []);
  assert.deepEqual(prepared.targets.map(target => target.newAccount?.kind), ["savings"]);
  assert.deepEqual(prepared.targets.map(target => target.newAccount?.opening), [{
    kind: "current",
    amount: "1234.50",
    date: "2024-07-01"
  }]);
});

test("an unchosen source and an unreadable balance block the check", () => {
  const rows = [mappedRow(2, "2024-07-01", "-1.00", "A", {
    source: "Wallet"
  }), mappedRow(3, "2024-07-01", "-1.00", "A", {
    source: "Card"
  })];
  const prepared = prepareImport(rows, new Map<string, TargetChoice>([["Wallet", {
    kind: "new",
    name: "Wallet",
    accountKind: "checking",
    currency: "EUR",
    balanceKind: "start",
    balance: "twelve"
  }]]), [], new Map(), ".");

  assert.deepEqual(prepared.problems.map(problem => [problem.field === "category" ? problem.value : problem.source, problem.field]), [["Wallet", "balance"], ["Card", "target"]]);
});

test("category values preselect only an existing category of the same name; the rest start unset", () => {
  const rows = [mappedRow(2, "2024-07-01", "-1.00", "A", {
    category: "synthetic FOOD"
  }), mappedRow(3, "2024-07-02", "-1.00", "B", {
    category: "Hobby"
  }), mappedRow(4, "2024-07-03", "-1.00", "C", {
    category: "Food, Travel"
  }), mappedRow(5, "2024-07-04", "-1.00", "D", {
    category: "Hobby"
  })];
  const values = categoryValues(rows, [{
    id: "synthetic-food",
    name: "Synthetic food"
  }]);
  const selections = new Map(values.map(value => [value.value, defaultCategorySelection(value)]));

  assert.deepEqual(values.map(value => [value.value, value.rows, value.multiTag]), [["Hobby", 2, false], ["Food, Travel", 1, true], ["synthetic FOOD", 1, false]]);
  assert.deepEqual([...selections.values()], [{
    action: "unset"
  }, {
    action: "unset"
  }, {
    action: "existing",
    categoryId: "synthetic-food"
  }]);
});

test("an unset category value blocks the check until a choice is made, and only chosen values are sent", () => {
  const rows = [mappedRow(2, "2024-07-01", "-1.00", "A", {
    category: "Hobby"
  }), mappedRow(3, "2024-07-02", "-1.00", "B", {
    category: "synthetic FOOD"
  })];
  const values = categoryValues(rows, [{
    id: "synthetic-food",
    name: "Synthetic food"
  }]);
  const selections = new Map(values.map(value => [value.value, defaultCategorySelection(value)]));
  const target = new Map<string, TargetChoice>([["", {
    kind: "existing",
    accountId: "wallet"
  }]]);
  const accounts = [{
    id: "wallet",
    name: "Wallet",
    currency: "EUR"
  }];
  const blocked = prepareImport(rows, target, accounts, selections, ".");

  assert.deepEqual(blocked.problems, [{
    value: "Hobby",
    field: "category",
    message: "Choose a category."
  }]);
  assert.deepEqual(blocked.categories.map(choice => choice.value), ["synthetic FOOD"]);

  selections.set("Hobby", {
    action: "create"
  });

  const ready = prepareImport(rows, target, accounts, selections, ".");

  assert.deepEqual(ready.problems, []);
  assert.deepEqual(ready.categories.map(choice => [choice.value, choice.action, choice.categoryId]), [["Hobby", "create", undefined], ["synthetic FOOD", "existing", "synthetic-food"]]);
});

test("a new account's balance stated in another currency blocks the check", () => {
  const rows = [mappedRow(2, "2024-07-01", "-1.00", "A", {
    source: "Wallet"
  })];
  const prepare = (balance: string) => prepareImport(rows, new Map<string, TargetChoice>([["Wallet", {
    kind: "new",
    name: "Wallet",
    accountKind: "checking",
    currency: "EUR",
    balanceKind: "current",
    balance
  }]]), [], new Map(), ".").problems.map(problem => problem.message);

  assert.deepEqual(prepare("USD 1000"), ["Enter the balance in EUR."]);
  assert.deepEqual(prepare("$1000"), ["Enter the balance in EUR."]);
  assert.deepEqual(prepare("€1000"), []);
  assert.deepEqual(prepare("1000"), []);
});

test("long account values are row errors instead of merging into one source", () => {
  const prefix = "Synthetic account ".padEnd(200, "x");
  const result = mapRows([["2024-01-01", "1.00", "Shop", `${prefix}A`], ["2024-01-02", "2.00", "Shop", `${prefix}B`], ["2024-01-03", "3.00", "Shop", "Short account"]], {
    ...emptyMapping,
    date: 0,
    amount: 1,
    payee: 2,
    account: 3
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.deepEqual(result.errors.map(error => error.line), [2, 3]);
  assert.deepEqual(result.rows.map(row => row.source), ["Short account"]);
});

test("an account is preselected only when exactly one has the source's name, and same-named accounts get distinct labels", () => {
  const accounts = [{
    id: "synthetic-0001",
    name: "Wallet",
    currency: "EUR",
    institution: "Bank A"
  }, {
    id: "synthetic-0002",
    name: "wallet",
    currency: "EUR",
    institution: "Bank B"
  }, {
    id: "synthetic-0003",
    name: "Savings",
    currency: "EUR",
    institution: "Bank A"
  }];

  assert.deepEqual(defaultTargetChoice("Wallet", accounts), {
    kind: "unset"
  });
  assert.deepEqual(defaultTargetChoice("Savings", accounts), {
    kind: "existing",
    accountId: "synthetic-0003"
  });
  assert.notEqual(accountLabel(accounts[0], accounts), accountLabel(accounts[1], accounts));
  assert.equal(accountLabel(accounts[2], accounts), "Savings (EUR)");
});

test("long category values are row errors instead of merging into one choice", () => {
  const prefix = "Synthetic category ".padEnd(100, "x");
  const result = mapRows([["2024-01-01", "1.00", "Shop", `${prefix}A`], ["2024-01-02", "2.00", "Shop", `${prefix}B`], ["2024-01-03", "3.00", "Shop", "Food"]], {
    ...emptyMapping,
    date: 0,
    amount: 1,
    payee: 2,
    category: 3
  }, {
    encoding: "utf-8",
    delimiter: ",",
    decimal: ".",
    dateFormat: "YYYY-MM-DD"
  });

  assert.deepEqual(result.errors.map(error => error.line), [2, 3]);
  assert.deepEqual(result.rows.map(row => row.category), ["Food"]);
});

test("a check stops applying when a preselected target changes after an account refetch", () => {
  const rows = [mappedRow(2, "2024-07-01", "-1.00", "A", {
    source: "Wallet"
  })];
  const account = (id: string) => ({
    id,
    name: "Wallet",
    currency: "EUR"
  });
  const before = prepareImport(rows, new Map([["Wallet", defaultTargetChoice("Wallet", [account("synthetic-1")])]]), [account("synthetic-1")], new Map(), ".");
  const after = prepareImport(rows, new Map([["Wallet", defaultTargetChoice("Wallet", [account("synthetic-2")])]]), [account("synthetic-2")], new Map(), ".");

  assert.notEqual(importKey(before), importKey(after));
  assert.equal(importKey(before), importKey(prepareImport(rows, new Map([["Wallet", defaultTargetChoice("Wallet", [account("synthetic-1")])]]), [account("synthetic-1")], new Map(), ".")));
});

test("a new account name over the server's limit is shortened in the prefill and reported when typed", () => {
  const source = "Synthetic account ".padEnd(150, "x");
  const prefill = newAccountChoice(source);
  const rows = [mappedRow(2, "2024-07-01", "-1.00", "A", {
    source
  })];

  assert.equal(prefill.kind === "new" ? prefill.name.length : 0, 100);
  assert.deepEqual(prepareImport(rows, new Map([[source, prefill]]), [], new Map(), ".").problems, []);
  assert.equal(prepareImport(rows, new Map<string, TargetChoice>([[source, {
    ...newAccountChoice(source),
    kind: "new",
    name: source,
    accountKind: "checking",
    currency: "EUR",
    balanceKind: "current",
    balance: ""
  }]]), [], new Map(), ".").problems.length, 1);
});

test("a delimiter that breaks the file's quoting reads as no table instead of throwing", () => {
  // With a semicolon delimiter, the second cell opens a quoted field that never closes.
  const bytes = new TextEncoder().encode("Payee,Amount\nSynthetic 5\";\"Shop,1.00\n");

  assert.equal(readCsvTable(bytes, {
    encoding: "utf-8",
    delimiter: ","
  })?.rows.length, 1);
  assert.equal(readCsvTable(bytes, {
    encoding: "utf-8",
    delimiter: ";"
  }), null);
});

test("a record with a quoted line break reports the line it starts on, for every kind of line break", () => {
  for (const lineBreak of ["\n", "\r\n", "\r"]) {
    const text = ["date,payee", `2024-01-01,"Multi${lineBreak}line"`, "2024-01-02,Single"].join("\n");
    const records = parseCsvRecords(text, ",");

    assert.equal(records[1].line, 2, JSON.stringify(lineBreak));
  }
});

test("the import ID derives from the file's bytes as a UUID the server accepts", async () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const first = await importIdFor(encode("Date,Amount\n2024-01-01,1.00\n"));

  assert.equal(first, await importIdFor(encode("Date,Amount\n2024-01-01,1.00\n")));
  assert.notEqual(first, await importIdFor(encode("Date,Amount\n2024-01-01,2.00\n")));
  assert.ok(z.uuid().safeParse(first).success);
});

test("a row with an export ID is recognized as imported even after its date moved beyond the duplicate window", async context => {
  await isolatedDatabase(context);
  const account = await manualAccount("Identified history");
  const targets = [{
    source: "",
    account_id: account.id
  }];

  await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-04-01", "-12.00", "Bakery", {
      id: "tx-moved"
    })],
    targets,
    confirm: true
  }, now);

  const checked = await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-04-20", "-12.00", "Bakery", {
      id: "tx-moved"
    })],
    targets,
    confirm: false
  }, now);

  assert.equal(checked.newRows, 0);
  assert.deepEqual(checked.duplicates.map(duplicate => duplicate.reason), ["already_imported"]);
});

test("batches hold at most as many source accounts as a request accepts targets", () => {
  const rows = Array.from({
    length: 120
  }, (_value, index) => mappedRow(index + 2, "2024-01-01", "-1.00", "Shop", {
    source: `Synthetic account ${index}`
  }));
  const batches = batchRows(rows);

  assert.equal(batches.flat().length, 120);
  assert.ok(batches.length > 1);
  assert.ok(batches.every(batch => new Set(batch.map(row => row.source)).size <= maxTargetsPerRequest));
});

test("a new account from an import gets the type the person chose", async context => {
  await isolatedDatabase(context);

  await importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop")],
    targets: [{
      source: "",
      new_account: {
        name: "Imported card",
        kind: "credit_card",
        currency: "EUR"
      }
    }],
    confirm: true
  }, now);

  assert.equal((await listAccounts()).find(account => account.name === "Imported card")?.kind, "credit_card");

  for (const kind of ["current", "start"] as const) {
    await assert.rejects(importMappedRows({
      import_id: "00000000-0000-4000-8000-000000000216",
      rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop")],
      targets: [{
        source: "",
        new_account: {
          name: "Imported loan",
          kind: "loan",
          currency: "EUR",
          opening: {
            kind,
            amount: "500.00",
            date: "2024-05-01"
          }
        }
      }],
      confirm: true
    }, now), ValidationError);
  }

  assert.equal((await listAccounts()).some(account => account.name === "Imported loan"), false);
  const loanChoice = new Map<string, TargetChoice>([["", {
    kind: "new",
    name: "Imported loan",
    accountKind: "loan",
    currency: "EUR",
    balanceKind: "current",
    balance: "500.00"
  }]]);

  assert.deepEqual(prepareImport([mappedRow(2, "2024-05-01", "-10.00", "Shop")], loanChoice, [], new Map(), ".").problems.map(problem => problem.field), ["balance"]);
  await assert.rejects(importMappedRows({
    import_id: "00000000-0000-4000-8000-000000000215",
    rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop")],
    targets: [{
      source: "",
      new_account: {
        name: "Unknown type",
        kind: "pension",
        currency: "EUR"
      }
    }],
    confirm: true
  }, now));
});

test("the same file imported as a new account in two banking environments creates one account in each", async context => {
  const db = await isolatedDatabase(context);
  const payload = {
    import_id: importId,
    rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop")],
    targets: [{
      source: "",
      new_account: {
        name: "Imported wallet",
        kind: "checking",
        currency: "EUR"
      }
    }],
    confirm: true
  };

  await importMappedRows(payload, now);
  process.env.ENABLE_BANKING_ENVIRONMENT = "PRODUCTION";
  await importMappedRows(payload, now);

  const accounts = await db.select().from(schema.accounts);
  const bookings = await db.select().from(schema.transactions);

  assert.deepEqual(accounts.map(account => account.environment).sort(), ["PRODUCTION", "SANDBOX"]);
  assert.equal(new Set(bookings.map(booking => booking.account_id)).size, 2);
});

test("a resumed import must state the opening balance its new account already has", async context => {
  await isolatedDatabase(context);
  const withOpening = (kind: "current" | "start", amount: string) => ({
    import_id: importId,
    rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop")],
    targets: [{
      source: "",
      new_account: {
        name: "Imported wallet",
        kind: "checking",
        currency: "EUR",
        opening: {
          kind,
          amount,
          date: "2024-05-01"
        }
      }
    }],
    confirm: true
  });

  await importMappedRows(withOpening("current", "100.00"), now);
  await importMappedRows(withOpening("current", "100.00"), now);
  await assert.rejects(importMappedRows(withOpening("current", "90.00"), now), ValidationError);
  await assert.rejects(importMappedRows(withOpening("start", "100.00"), now), ValidationError);
  await assert.rejects(importMappedRows({
    ...withOpening("current", "100.00"),
    targets: [{
      source: "",
      new_account: {
        name: "Imported wallet",
        kind: "checking",
        currency: "EUR"
      }
    }]
  }, now), ValidationError);
});

test("hiding an imported row does not make an unchanged resume look like a changed opening balance", async context => {
  const db = await isolatedDatabase(context);
  const payload = {
    import_id: importId,
    rows: [mappedRow(2, "2024-05-01", "-10.00", "Shop"), mappedRow(3, "2024-05-02", "-5.00", "Bakery")],
    targets: [{
      source: "",
      new_account: {
        name: "Imported wallet",
        kind: "checking",
        currency: "EUR",
        opening: {
          kind: "current" as const,
          amount: "100.00",
          date: "2024-05-01"
        }
      }
    }],
    confirm: true
  };

  await importMappedRows(payload, now);
  const bakery = (await db.select().from(schema.transactions)).find(booking => booking.counterparty === "Bakery");

  assert.ok(bakery);
  await hideTransaction(bakery.id, true, now);
  await importMappedRows(payload, now);

  assert.equal(await db.$count(schema.transactions), 3);
});

test("batches hold at most as many category values as a request accepts choices", () => {
  const rows = Array.from({
    length: 1200
  }, (_value, index) => mappedRow(index + 2, "2024-01-01", "-1.00", "Shop", {
    category: `Synthetic category ${index}`
  }));
  const batches = batchRows(rows);

  assert.equal(batches.flat().length, 1200);
  assert.ok(batches.every(batch => new Set(batch.map(row => row.category)).size <= maxCategoryChoicesPerRequest));
});

test("an archived account is refused as an import target until it is restored", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Archived target");
  const payload = {
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop")],
    targets: [{
      source: "",
      account_id: account.id
    }]
  };

  await archiveAccount(account.id, {});

  for (const confirm of [false, true]) {
    await assert.rejects(importMappedRows({
      ...payload,
      confirm
    }, now), {
      status: 409,
      message: "This account is archived. Restore the account first."
    });
  }

  assert.equal((await db.select().from(schema.transactions)).length, 0);

  await restoreAccount(account.id);
  assert.equal((await importMappedRows({
    ...payload,
    confirm: true
  }, now)).newRows, 1);
});

test("an account archived after the target check receives no imported rows", async context => {
  const db = await isolatedDatabase(context);
  const account = await manualAccount("Archived meanwhile");
  const execute = db.$client.execute.bind(db.$client);
  let interleaved = false;

  context.mock.method(db.$client, "execute", async (statement: InStatement, args?: InArgs) => {
    const result = typeof statement === "string" ? await execute(statement, args) : await execute(statement);
    const text = typeof statement === "string" ? statement : statement.sql;

    if (!interleaved && /^select /i.test(text) && text.includes('from "accounts"')) {
      interleaved = true;
      await execute({
        sql: "UPDATE accounts SET archived_at='2026-06-30T00:00:00.000Z' WHERE id=?",
        args: [account.id]
      });
    }

    return result;
  });

  await assert.rejects(importMappedRows({
    import_id: importId,
    rows: [mappedRow(2, "2024-01-01", "-10.00", "Shop")],
    targets: [{
      source: "",
      account_id: account.id
    }],
    confirm: true
  }, now), {
    status: 409,
    message: "This account is archived. Restore the account first."
  });
  assert.ok(interleaved);
  assert.equal((await db.select().from(schema.transactions)).length, 0);
});
