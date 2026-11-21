import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase, migrateDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { normalizeTransactions } from "../src/features/banking/server/bank-data";
import type { BankTransaction } from "../src/features/banking/server/enable-banking-client";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { editManualTransaction } from "../src/features/transactions/server/transaction-service";
import { monthPeriod } from "../src/lib/period";
import { matchBooking, prepareBooking, prepareBookings } from "../src/lib/booking-matching";

type Globals = {
  budgetDb?: Promise<Database>
};

function useDatabase(context: TestContext, client: Client) {
  const globals = globalThis as unknown as Globals;
  const previousDatabase = globals.budgetDb;
  const db = drizzle(client, {
    schema
  });

  context.after(() => {
    globals.budgetDb = previousDatabase;
    client.close();
  });
  globals.budgetDb = Promise.resolve(db);

  return db;
}

async function freshDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });

  await initializeDatabase(client);
  const db = useDatabase(context, client);

  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking"
  });

  return db;
}

/** A card payment made on 31 Oct that the bank books on 2 Nov. */
const cardPayment: BankTransaction = {
  entry_reference: "card-1",
  status: "BOOK",
  booking_date: "2026-11-02",
  value_date: "2026-10-31",
  transaction_amount: {
    amount: "42.00",
    currency: "EUR"
  },
  credit_debit_indicator: "DBIT",
  creditor: {
    name: "Example Market"
  },
  remittance_information: ["Card payment Example Market 31.10. 16:33"]
};

async function syncBookings(transactions: BankTransaction[], balance: {
  amount: string;
  date: string;
}) {
  await saveAccountSync({
    startedAt: `${balance.date}T08:00:00.000Z`
  }, "checking", "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: balance.amount,
      currency: "EUR"
    },
    reference_date: balance.date
  }], normalizeTransactions(transactions, new Set()), []);
}

async function storedDates(db: Database) {
  return db.select({
    reference: schema.transactions.provider_reference,
    date: schema.transactions.date,
    bankDate: schema.transactions.booking_date
  }).from(schema.transactions).where(eq(schema.transactions.type, "expense"));
}

test("a bank booking counts on its value date and keeps the bank's booking date", () => {
  const [entry] = normalizeTransactions([cardPayment], new Set());

  assert.equal(entry.date, "2026-10-31");
  assert.equal(entry.bookingDate, "2026-11-02");

  const [withoutValueDate] = normalizeTransactions([{
    ...cardPayment,
    value_date: null
  }], new Set());

  assert.equal(withoutValueDate.date, "2026-11-02");
  assert.equal(withoutValueDate.bookingDate, "2026-11-02");

  const [malformedBookingDate] = normalizeTransactions([{
    ...cardPayment,
    booking_date: "02.11.2026"
  }], new Set());

  assert.equal(malformedBookingDate.date, "2026-10-31");
  assert.equal(malformedBookingDate.bookingDate, null);
  assert.throws(() => normalizeTransactions([{
    ...cardPayment,
    booking_date: null,
    value_date: null
  }], new Set()), /valid booking or value date/);
});

test("a synced card payment counts in the month of its value date, and re-syncing neither duplicates it nor moves it", async context => {
  const db = await freshDatabase(context);

  await syncBookings([cardPayment], {
    amount: "958.00",
    date: "2026-11-02"
  });
  await syncBookings([cardPayment], {
    amount: "958.00",
    date: "2026-11-03"
  });

  assert.deepEqual(await storedDates(db), [{
    reference: "bank:card-1",
    date: "2026-10-31",
    bankDate: "2026-11-02"
  }]);
  assert.equal((await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-10")), "EUR")).expenses, 4200);
  assert.equal((await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-11")), "EUR")).expenses, 0);

  const account = (await listAccounts()).find(item => item.id === "checking");

  assert.equal(account?.balance_minor, 95800);
  assert.equal(account?.reported_difference_minor, 0);
});

test("a balance the bank reports before booking a payment compares with the bank's booking dates", async context => {
  await freshDatabase(context);

  // The 1 Nov balance does not contain the payment the bank books on 2 Nov, although it counts on 31 Oct.
  await syncBookings([cardPayment], {
    amount: "1000.00",
    date: "2026-11-01"
  });

  const account = (await listAccounts()).find(item => item.id === "checking");

  assert.equal(account?.balance_minor, 95800);
  assert.equal(account?.reported_difference_minor, 0);
});

test("the date of a synced booking stays the bank's: an edit is refused and a re-sync keeps the value date", async context => {
  const db = await freshDatabase(context);

  await syncBookings([cardPayment], {
    amount: "958.00",
    date: "2026-11-02"
  });

  const [stored] = await db.select({
    id: schema.transactions.id
  }).from(schema.transactions).where(eq(schema.transactions.provider_reference, "bank:card-1"));

  await assert.rejects(editManualTransaction(stored.id, {
    type: "expense",
    date: "2026-11-05",
    amount: "-42.00",
    counterparty: "Example Market",
    description: ""
  }, Temporal.Instant.from("2026-11-06T12:00:00Z")));
  await syncBookings([cardPayment], {
    amount: "958.00",
    date: "2026-11-06"
  });

  assert.deepEqual(await storedDates(db), [{
    reference: "bank:card-1",
    date: "2026-10-31",
    bankDate: "2026-11-02"
  }]);
});

function csvRow(date: string) {
  return {
    line: 2,
    date,
    amount: "-42.00",
    currency: "EUR",
    payee: "Example Market",
    description: "Card payment",
    category: null,
    source: "",
    occurrence: 0,
    id: null,
    transfer: false,
    parts: null,
    tags: null
  };
}

async function importRow(date: string) {
  return importMappedRows({
    import_id: "00000000-0000-4000-8000-000000000315",
    rows: [csvRow(date)],
    targets: [{
      source: "",
      account_id: "checking"
    }],
    confirm: true
  }, Temporal.Instant.from("2026-11-20T12:00:00Z"));
}

test("a CSV row dated on the bank's booking date matches a value-dated bank booking outside the date tolerance", async context => {
  const db = await freshDatabase(context);
  // Six days between purchase and booking: only the bank's booking date lies within the tolerance of the exported row.
  const delayed = {
    ...cardPayment,
    value_date: "2026-10-27"
  };

  await syncBookings([delayed], {
    amount: "958.00",
    date: "2026-11-02"
  });

  const result = await importRow("2026-11-02");

  assert.deepEqual(result.duplicates.map(duplicate => duplicate.reason), ["existing_booking"]);
  assert.equal((await storedDates(db)).length, 1);
});

test("a bank delivery adopts a CSV row dated on its booking date and moves it to the value date", async context => {
  const db = await freshDatabase(context);

  await importRow("2026-11-02");
  await syncBookings([{
    ...cardPayment,
    value_date: "2026-10-27"
  }], {
    amount: "958.00",
    date: "2026-11-02"
  });

  assert.deepEqual(await storedDates(db), [{
    reference: "bank:card-1",
    date: "2026-10-27",
    bankDate: "2026-11-02"
  }]);
});

async function databaseBefore0018(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-value-dates-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0018_transaction_value_dates"));
  const client = createClient({
    url: ":memory:"
  });

  context.after(() => {
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });
  mkdirSync(join(directory, "meta"));

  for (const entry of previousEntries) {
    cpSync(`drizzle/sqlite/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(join(directory, "meta/_journal.json"), JSON.stringify({
    ...journal,
    entries: previousEntries
  }));
  await migrateDatabase(client, directory);

  return client;
}

test("the value-date upgrade keeps every row and the next sync moves a redelivered booking to its value date", async context => {
  const client = await databaseBefore0018(context);

  await client.batch([
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid) VALUES('checking','Synthetic checking','Example bank','checking','enable_banking','synthetic-1')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('opening','checking','manual:opening','2026-10-20',100000,'EUR','opening_balance')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,type) VALUES('card','checking','bank:card-1','2026-11-02',-4200,'EUR','Example Market','Card payment Example Market 31.10. 16:33','expense')"
  ], "write");

  const rows = "SELECT id,amount_minor FROM transactions ORDER BY id";
  const before = (await client.execute(rows)).rows;

  await migrateDatabase(client);

  assert.deepEqual((await client.execute(rows)).rows, before);
  assert.deepEqual((await client.execute("SELECT id,date,booking_date FROM transactions ORDER BY id")).rows.map(row => [row.id, row.date, row.booking_date]), [
    ["card", "2026-11-02", null],
    ["opening", "2026-10-20", null]
  ]);

  const db = useDatabase(context, client);

  await syncBookings([cardPayment], {
    amount: "958.00",
    date: "2026-11-03"
  });

  assert.deepEqual(await storedDates(db), [{
    reference: "bank:card-1",
    date: "2026-10-31",
    bankDate: "2026-11-02"
  }]);
  assert.equal((await listAccounts()).find(item => item.id === "checking")?.balance_minor, 95800);
});

test("a date shared only through a bank booking date with several bookings is ambiguous", () => {
  const candidate = prepareBooking({
    date: "2026-11-02",
    amount: -4200,
    counterparty: "Example Market",
    description: ""
  });
  const bookings = prepareBookings([{
    date: "2026-10-31",
    bookingDate: "2026-11-02",
    amount: -4200,
    counterparty: "Example Market",
    description: ""
  }, {
    date: "2026-11-02",
    bookingDate: "2026-11-04",
    amount: -4200,
    counterparty: "Example Market",
    description: ""
  }]);

  assert.equal(matchBooking(candidate, bookings, () => true), "ambiguous");
  assert.equal(matchBooking(candidate, prepareBookings([bookings.bookings[0]]), () => true), 0);
});

test("a repeated bank reference with another booking date stops the import", () => {
  assert.throws(() => normalizeTransactions([cardPayment, {
    ...cardPayment,
    booking_date: "2026-11-03"
  }], new Set()), /different transactions/);
});
