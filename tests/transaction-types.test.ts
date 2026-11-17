import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { pairTransfersInEnvironment } from "../src/features/transactions/server/transfer-repository";
import { unambiguousPairs } from "../src/features/transactions/server/transfer-pairing";
import { linkTransfer, transferOptions, unlinkTransfer, updateTransactionType } from "../src/features/transactions/server/transaction-service";
import { importTransactions } from "../src/features/imports/server/import-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { monthPeriod } from "../src/lib/period";
import { HttpError, ValidationError } from "../src/lib/errors";
import type { Entry } from "../src/features/transactions/server/transaction-entry";

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
  await db.insert(schema.accounts).values([{
    id: "checking",
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking"
  }, {
    id: "savings",
    environment: "SANDBOX",
    name: "Synthetic savings",
    institution: "Example bank",
    kind: "savings",
    provider: "enable_banking"
  }, {
    id: "dollars",
    environment: "SANDBOX",
    name: "Synthetic dollars",
    institution: "Example bank",
    kind: "checking",
    currency: "USD",
    provider: "enable_banking"
  }, {
    id: "property",
    environment: "SANDBOX",
    name: "Synthetic flat",
    institution: "Land register",
    kind: "property"
  }]);

  return db;
}

let runCounter = 0;

/** Stores one account's bank delivery and then pairs transfers, as a sync does once every account is stored. */
async function sync(db: Database, accountId: string, entries: Entry[], currency = "EUR") {
  runCounter += 1;
  const run = {
    environment: "SANDBOX",
    startedAt: `2026-09-30T08:00:${String(runCounter % 60).padStart(2, "0")}.000Z`
  };
  const balances = [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "0.00",
      currency
    },
    reference_date: "2026-09-30"
  }];

  await saveAccountSync(db, run, accountId, currency, balances, entries, []);
  await pairTransfersInEnvironment("SANDBOX");
}

function entry(reference: string, date: string, amount: number, transfer = false, currency = "EUR"): Entry {
  return {
    reference: `bank:${reference}`,
    date,
    amount,
    currency,
    counterparty: "Example counterparty",
    description: `Synthetic ${reference}`,
    transfer
  };
}

async function stored(db: Database, reference: string) {
  const row = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, `bank:${reference}`)).get();

  assert.ok(row, reference);

  return row;
}

async function linked(db: Database, first: string, second: string) {
  const [one, two] = [await stored(db, first), await stored(db, second)];

  return one.transfer_id !== null && one.transfer_id === two.transfer_id;
}

test("only bookings whose two sides each have exactly one candidate are paired", () => {
  assert.deepEqual(unambiguousPairs([]), []);
  assert.deepEqual(unambiguousPairs([{
    outgoingId: "out",
    incomingId: "in"
  }]), [{
    outgoingId: "out",
    incomingId: "in"
  }]);
  // One outgoing booking with two possible incoming ones, and one incoming booking matching two outgoing ones.
  assert.deepEqual(unambiguousPairs([{
    outgoingId: "out",
    incomingId: "in-1"
  }, {
    outgoingId: "out",
    incomingId: "in-2"
  }, {
    outgoingId: "out-2",
    incomingId: "in-3"
  }, {
    outgoingId: "out-3",
    incomingId: "in-3"
  }, {
    outgoingId: "out-4",
    incomingId: "in-4"
  }]), [{
    outgoingId: "out-4",
    incomingId: "in-4"
  }]);
});

test("synced bookings get a type by direction and detected transfers, and cash flow counts only income and expenses", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("salary", "2026-09-01", 300000), entry("market", "2026-09-02", -4500), entry("to-savings", "2026-09-03", -50000, true)]);
  await sync(db, "savings", [entry("from-checking", "2026-09-03", 50000, true)]);

  assert.equal((await stored(db, "salary")).type, "income");
  assert.equal((await stored(db, "market")).type, "expense");
  assert.equal((await stored(db, "to-savings")).type, "transfer");
  assert.ok(await linked(db, "to-savings", "from-checking"));

  const refund = await db.insert(schema.transactions).values({
    id: "refund",
    account_id: "checking",
    provider_reference: "csv:refund",
    booking_date: "2026-09-05",
    amount_minor: 1500,
    currency: "EUR",
    category_id: "groceries",
    type: "income"
  }).returning();

  // A refund corrected to an expense reduces spending in its category instead of counting as income.
  await updateTransactionType(refund[0].id, {
    type: "expense"
  });
  const cashFlow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR");

  assert.equal(cashFlow.income, 300000);
  assert.equal(cashFlow.expenses, 3000);
});

test("automatic pairing needs opposite amounts in one currency on two accounts within three days and exactly one candidate", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [
    entry("single", "2026-09-01", -10000, true),
    entry("ambiguous", "2026-09-10", -20000, true),
    entry("late", "2026-09-20", -30000, true),
    entry("currency", "2026-09-25", -40000, true),
    entry("same-account-out", "2026-09-26", -5000, true),
    entry("same-account-in", "2026-09-26", 5000)
  ]);
  await sync(db, "savings", [
    entry("single-in", "2026-09-04", 10000),
    entry("ambiguous-in-1", "2026-09-10", 20000, true),
    entry("ambiguous-in-2", "2026-09-11", 20000),
    entry("late-in", "2026-09-24", 30000, true)
  ]);
  await sync(db, "dollars", [entry("currency-in", "2026-09-25", 40000, true, "USD")], "USD");

  // An income nobody corrected becomes the transfer's incoming side when it is the only match.
  assert.ok(await linked(db, "single", "single-in"));
  assert.equal((await stored(db, "single-in")).type, "transfer");
  assert.equal((await stored(db, "ambiguous")).transfer_id, null);
  assert.equal((await stored(db, "ambiguous-in-1")).transfer_id, null);
  assert.equal((await stored(db, "ambiguous-in-2")).type, "income");
  assert.equal((await stored(db, "late")).transfer_id, null);
  assert.equal((await stored(db, "currency")).transfer_id, null);
  assert.equal((await stored(db, "same-account-out")).transfer_id, null);
  assert.equal((await stored(db, "same-account-in")).type, "income");
});

test("manual types, links and unlinks survive resync and later pairing", async context => {
  const db = await isolatedDatabase(context);
  const checking = [entry("paired-out", "2026-09-01", -10000, true), entry("refund", "2026-09-02", 2500), entry("relinked-out", "2026-09-10", -7000, true)];
  const savings = [entry("paired-in", "2026-09-01", 10000, true), entry("relinked-in-1", "2026-09-10", 7000), entry("relinked-in-2", "2026-09-11", 7000)];

  await sync(db, "checking", checking);
  await sync(db, "savings", savings);
  assert.ok(await linked(db, "paired-out", "paired-in"));
  assert.equal((await stored(db, "relinked-out")).transfer_id, null);

  await unlinkTransfer((await stored(db, "paired-out")).id);
  await updateTransactionType((await stored(db, "refund")).id, {
    type: "expense"
  });
  await linkTransfer((await stored(db, "relinked-out")).id, {
    counterpart_id: (await stored(db, "relinked-in-2")).id
  });

  await sync(db, "checking", checking);
  await sync(db, "savings", savings);

  assert.equal((await stored(db, "paired-out")).transfer_id, null);
  assert.equal((await stored(db, "paired-out")).type, "transfer");
  assert.equal((await stored(db, "paired-in")).transfer_id, null);
  assert.equal((await stored(db, "refund")).type, "expense");
  assert.ok(await linked(db, "relinked-out", "relinked-in-2"));
  assert.equal((await stored(db, "relinked-in-1")).type, "income");
});

test("leaving the transfer type corrects both linked bookings together", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("out", "2026-09-01", -10000, true)]);
  await sync(db, "savings", [entry("in", "2026-09-01", 10000, true)]);
  await updateTransactionType((await stored(db, "out")).id, {
    type: "expense"
  });

  const [out, incoming] = [await stored(db, "out"), await stored(db, "in")];

  assert.deepEqual([out.type, out.transfer_id, out.type_source], ["expense", null, "manual"]);
  assert.deepEqual([incoming.type, incoming.transfer_id, incoming.type_source], ["income", null, "manual"]);
});

test("a transfer to a manual account creates its counterpart there, and unlinking removes it again", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("deposit", "2026-09-15", -2500000)]);
  const deposit = await stored(db, "deposit");
  const options = await transferOptions(deposit.id);

  assert.deepEqual(options.accounts, [{
    id: "property",
    name: "Synthetic flat"
  }]);
  await assert.rejects(linkTransfer(deposit.id, {
    account_id: "dollars"
  }), ValidationError);
  await linkTransfer(deposit.id, {
    account_id: "property"
  });

  const created = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property")).get();

  assert.ok(created);
  assert.equal(created.amount_minor, 2500000);
  assert.equal(created.booking_date, "2026-09-15");
  assert.equal(created.transfer_id, (await stored(db, "deposit")).transfer_id);

  const page = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-09&currency=EUR")));
  const shown = page.transactions.find(transaction => transaction.id === deposit.id);

  assert.equal(shown?.counterpart?.account_name, "Synthetic flat");
  assert.equal((await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-09")), "EUR")).expenses, 0);
  await assert.rejects(linkTransfer(deposit.id, {
    account_id: "property"
  }), (error: unknown) => error instanceof HttpError && error.status === 409);

  await unlinkTransfer(deposit.id);

  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "property"))).length, 0);
  assert.deepEqual([(await stored(db, "deposit")).type, (await stored(db, "deposit")).transfer_id], ["transfer", null]);
});

test("opening balances and adjustments are refused for bank-synced bookings", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [entry("synced", "2026-09-01", -100)]);
  await assert.rejects(updateTransactionType((await stored(db, "synced")).id, {
    type: "adjustment"
  }), ValidationError);
  await assert.rejects(updateTransactionType("missing", {
    type: "income"
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
});

test("a CSV import pairs its bookings with an unpaired transfer of a synced account", async context => {
  const db = await isolatedDatabase(context);

  await db.insert(schema.accounts).values({
    id: "cash",
    environment: "SANDBOX",
    name: "Synthetic cash",
    institution: "Wallet",
    kind: "savings"
  });
  await sync(db, "checking", [entry("withdrawal", "2026-09-01", -20000, true)]);
  await importTransactions({
    account_id: "cash",
    csv: "id,date,amount,currency,counterparty,description\ncash-1,2026-09-02,200.00,EUR,ATM,Cash withdrawal"
  });

  const cash = await db.select().from(schema.transactions).where(eq(schema.transactions.account_id, "cash")).get();

  assert.equal(cash?.type, "transfer");
  assert.equal(cash?.transfer_id, (await stored(db, "withdrawal")).transfer_id);
});
