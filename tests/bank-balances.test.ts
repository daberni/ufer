import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase, migrateDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { listAccounts, readBalanceHistory, readNetWorth } from "../src/features/accounts/server/account-queries";
import { reconcileBankBalance } from "../src/features/accounts/server/account-service";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { monthPeriod } from "../src/lib/period";
import { HttpError } from "../src/lib/errors";
import { importMappedRows } from "../src/features/imports/server/mapped-import-service";

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

type Booking = {
  reference: string;
  date: string;
  amount: number;
};

/** One sync delivery: the balance the bank reports and the booked transactions it returns. */
async function sync(balance: {
  amount: string;
  date: string;
  type?: string;
}, bookings: Booking[]) {
  await saveAccountSync({
    startedAt: `${balance.date}T08:00:00.000Z`
  }, "checking", "EUR", [{
    balance_type: balance.type ?? "CLBD",
    balance_amount: {
      amount: balance.amount,
      currency: "EUR"
    },
    reference_date: balance.date
  }], bookings.map(booking => ({
    reference: booking.reference,
    date: booking.date,
    amount: booking.amount,
    currency: "EUR",
    counterparty: "Example counterparty",
    description: `Synthetic ${booking.reference}`
  })), []);
}

async function checking() {
  const account = (await listAccounts()).find(item => item.id === "checking");

  assert.ok(account);

  return account;
}

async function openingBalances(db: Database) {
  return db.select({
    date: schema.transactions.booking_date,
    amount: schema.transactions.amount_minor
  }).from(schema.transactions).where(and(eq(schema.transactions.account_id, "checking"), eq(schema.transactions.type, "opening_balance")));
}

const firstBookings: Booking[] = [{
  reference: "bank:rent",
  date: "2026-09-10",
  amount: -5000
}, {
  reference: "bank:refund",
  date: "2026-09-20",
  amount: 2000
}];

test("the first sync books an opening balance so the calculated balance equals the reported balance", async context => {
  const db = await freshDatabase(context);

  await sync({
    amount: "1000.00",
    date: "2026-09-30"
  }, firstBookings);

  assert.deepEqual(await openingBalances(db), [{
    date: "2026-09-09",
    amount: 103000
  }]);

  const account = await checking();

  assert.equal(account.balance_minor, 100000);
  assert.equal(account.balance_date, "2026-09-20");
  assert.equal(account.reported_balance_minor, 100000);
  assert.equal(account.reported_balance_date, "2026-09-30");
  assert.equal(account.reported_difference_minor, 0);
  assert.equal((await readNetWorth("EUR")).netWorth, 100000);

  const history = (await readBalanceHistory("checking")).balances;
  const onDate = (date: string) => history.find(point => point.date === date)?.amount_minor;

  assert.equal(history[0].date, "2026-09-08");
  assert.equal(onDate("2026-09-08"), 0);
  assert.equal(onDate("2026-09-09"), 103000);
  assert.equal(onDate("2026-09-15"), 98000);
  assert.equal(onDate("2026-09-30"), 100000);
  assert.equal(history.at(-1)?.amount_minor, 100000);
  // Opening balances never count as income.
  assert.equal((await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR")).income, 2000);
});

test("later syncs keep the opening balance, and older bookings move it back without changing the balance", async context => {
  const db = await freshDatabase(context);

  await sync({
    amount: "1000.00",
    date: "2026-09-30"
  }, firstBookings);
  await sync({
    amount: "1000.00",
    date: "2026-10-01"
  }, firstBookings);

  assert.deepEqual(await openingBalances(db), [{
    date: "2026-09-09",
    amount: 103000
  }]);

  // A wider window returns an older booking that the opening balance already covered.
  await sync({
    amount: "1000.00",
    date: "2026-10-02"
  }, [{
    reference: "bank:older",
    date: "2026-09-01",
    amount: -10000
  }, ...firstBookings]);

  assert.deepEqual(await openingBalances(db), [{
    date: "2026-08-31",
    amount: 113000
  }]);

  const account = await checking();

  assert.equal(account.balance_minor, 100000);
  assert.equal(account.reported_difference_minor, 0);
});

test("a difference to the reported booked balance is shown and an adjustment on its date resolves it", async context => {
  const db = await freshDatabase(context);

  await sync({
    amount: "1000.00",
    date: "2026-09-30"
  }, firstBookings);
  await sync({
    amount: "990.00",
    date: "2026-10-05"
  }, firstBookings);

  const mismatched = await checking();

  assert.equal(mismatched.balance_minor, 100000);
  assert.equal(mismatched.reported_balance_minor, 99000);
  assert.equal(mismatched.reported_difference_minor, -1000);

  await reconcileBankBalance("checking");

  const adjustments = await db.select({
    date: schema.transactions.booking_date,
    amount: schema.transactions.amount_minor
  }).from(schema.transactions).where(eq(schema.transactions.type, "adjustment"));

  assert.deepEqual(adjustments, [{
    date: "2026-10-05",
    amount: -1000
  }]);

  const reconciled = await checking();

  assert.equal(reconciled.balance_minor, 99000);
  assert.equal(reconciled.reported_difference_minor, 0);
});

test("an available balance is never compared with the bookings and cannot be reconciled", async context => {
  await freshDatabase(context);

  await sync({
    amount: "1000.00",
    date: "2026-09-30"
  }, firstBookings);
  // Available balances include credit lines and pending items.
  await sync({
    amount: "3000.00",
    date: "2026-10-05",
    type: "CLAV"
  }, firstBookings);

  const account = await checking();

  assert.equal(account.balance_minor, 100000);
  assert.equal(account.reported_balance_minor, 300000);
  assert.equal(account.reported_difference_minor, null);
  await assert.rejects(reconcileBankBalance("checking"), (error: unknown) => error instanceof HttpError && error.status === 409);
});

test("history imported from a file before the opening balance extends the history without changing the balance", async context => {
  const db = await freshDatabase(context);

  await sync({
    amount: "1000.00",
    date: "2026-09-30"
  }, firstBookings);
  await importMappedRows({
    import_id: "00000000-0000-4000-8000-000000000183",
    rows: [{
      line: 2,
      date: "2026-08-15",
      amount: "-30.00",
      currency: "EUR",
      payee: "Older history",
      description: "",
      category: null,
      source: "",
      occurrence: 0,
      id: null,
      transfer: false,
      parts: null,
      tags: null
    }],
    targets: [{
      source: "",
      account_id: "checking"
    }],
    confirm: true
  }, Temporal.Instant.from("2026-10-01T12:00:00Z"));

  assert.deepEqual(await openingBalances(db), [{
    date: "2026-08-14",
    amount: 106000
  }]);

  const account = await checking();

  assert.equal(account.balance_minor, 100000);
  assert.equal(account.reported_difference_minor, 0);
});

async function databaseBefore0017(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-before-bank-balances-"));
  const journal = JSON.parse(readFileSync("drizzle/sqlite/meta/_journal.json", "utf8"));
  const previousEntries = journal.entries.slice(0, journal.entries.findIndex((entry: {
    tag: string
  }) => entry.tag === "0017_bank_account_balances_from_transactions"));
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

test("the bank balance upgrade keeps every current balance and net worth and books one opening balance per bank account", async context => {
  const client = await databaseBefore0017(context);

  await client.batch([
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid,balance_minor,balance_date) VALUES('checking','Synthetic checking','Example bank','checking','enable_banking','synthetic-1',100000,'2026-09-30')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid,balance_minor,balance_date) VALUES('card','Synthetic card','Example bank','credit_card','enable_banking','synthetic-2',-25000,'2026-09-28')",
    "INSERT INTO accounts(id,name,institution,kind,provider,provider_uid) VALUES('pending','Synthetic pending','Example bank','savings','enable_banking','synthetic-3')",
    "INSERT INTO accounts(id,name,institution,kind) VALUES('cash','Synthetic cash','Example institution','savings')",
    // Reported balances disagree with the bookings on 2026-09-15; that history is deliberately not booked.
    "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,bank_balance_type,source) VALUES('s1','checking','2026-09-05',90000,'CLBD','sync')",
    "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,bank_balance_type,source) VALUES('s2','checking','2026-09-15',85000,'CLBD','sync')",
    "INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,bank_balance_type,source) VALUES('s3','checking','2026-09-30',100000,'CLBD','sync')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('salary','checking','bank:1','2026-09-01',300000,'EUR','income')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('rent','checking','bank:2','2026-09-10',-90000,'EUR','expense')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type,suppressed_at) VALUES('hidden','checking','bank:3','2026-09-12',-7000,'EUR','expense','2026-09-13T00:00:00.000Z')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('card-spend','card','bank:4','2026-09-20',-5000,'EUR','expense')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,type) VALUES('cash-open','cash','manual:cash-open','2026-09-01',4000,'EUR','opening_balance')"
  ], "write");

  const balancesBefore = (await client.execute("SELECT id,COALESCE(balance_minor,(SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=accounts.id AND t.suppressed_at IS NULL)) AS balance FROM accounts ORDER BY id")).rows.map(row => [row.id, row.balance]);
  const transactionsBefore = (await client.execute("SELECT * FROM transactions ORDER BY id")).rows;

  await migrateDatabase(client);
  const db = useDatabase(context, client);
  const accountsAfter = await listAccounts();

  assert.deepEqual(accountsAfter.map(account => [account.id, account.balance_minor]).sort(), balancesBefore.sort());
  assert.equal((await readNetWorth("EUR")).netWorth, balancesBefore.reduce((total, [, balance]) => total + Number(balance ?? 0), 0));
  assert.deepEqual((await client.execute("SELECT * FROM transactions WHERE type<>'opening_balance' OR account_id='cash' ORDER BY id")).rows, transactionsBefore);

  const openings = await client.execute("SELECT account_id,booking_date,amount_minor,provider_reference='manual:' || id AS entered FROM transactions WHERE type='opening_balance' AND account_id<>'cash' ORDER BY account_id");

  assert.deepEqual(openings.rows.map(row => [row.account_id, row.booking_date, row.amount_minor, row.entered]), [
    ["card", "2026-09-19", -20000, 1],
    ["checking", "2026-08-31", -110000, 1]
  ]);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM accounts WHERE balance_minor IS NOT NULL OR balance_date IS NOT NULL")).rows[0].count, 0);
  assert.deepEqual((await client.execute("SELECT account_id,observed_at,amount_minor FROM balance_snapshots ORDER BY account_id,observed_at")).rows.map(row => [row.account_id, row.observed_at, row.amount_minor]), [
    ["card", "2026-09-28", -25000],
    ["checking", "2026-09-05", 90000],
    ["checking", "2026-09-15", 85000],
    ["checking", "2026-09-30", 100000]
  ]);

  const checkingAfter = accountsAfter.find(account => account.id === "checking");

  assert.equal(checkingAfter?.reported_difference_minor, 0);
  assert.equal(accountsAfter.find(account => account.id === "pending")?.balance_minor, null);
  assert.equal((await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR")).income, 300000);

  const history = (await readBalanceHistory("checking")).balances;

  assert.equal(history.find(point => point.date === "2026-09-30")?.amount_minor, 100000);

  // A sync after the upgrade keeps the migrated opening balance.
  await saveAccountSync({
    startedAt: "2026-10-01T08:00:00.000Z"
  }, "checking", "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "1000.00",
      currency: "EUR"
    },
    reference_date: "2026-10-01"
  }], [], []);

  const openingsAfterSync = await db.select().from(schema.transactions).where(and(eq(schema.transactions.account_id, "checking"), eq(schema.transactions.type, "opening_balance")));

  assert.equal(openingsAfterSync.length, 1);
  assert.equal((await listAccounts()).find(account => account.id === "checking")?.reported_difference_minor, 0);
});
