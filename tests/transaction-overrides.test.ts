import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { createManualAccount } from "../src/features/accounts/server/account-service";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { importTransactions } from "../src/features/imports/server/import-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { enterManualTransaction, hideTransaction, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { pairTransfersInEnvironment } from "../src/features/transactions/server/transfer-repository";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { monthPeriod } from "../src/lib/period";
import { HttpError, ValidationError } from "../src/lib/errors";

const now = Temporal.Instant.from("2026-10-31T12:00:00Z");
const september = monthPeriod(Temporal.PlainYearMonth.from("2026-09"));

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
  }]);

  return db;
}

type Booking = {
  reference: string;
  date: string;
  amount: number;
  counterparty?: string;
  description?: string;
};

/** Stores one sync delivery of bookings on a synced account. */
async function sync(db: Database, accountId: string, bookings: Booking[]) {
  await saveAccountSync(db, {
    environment: "SANDBOX",
    startedAt: "2026-09-30T08:00:00.000Z"
  }, accountId, "EUR", [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "1000.00",
      currency: "EUR"
    },
    reference_date: "2026-09-30"
  }], bookings.map(booking => ({
    reference: booking.reference,
    date: booking.date,
    amount: booking.amount,
    currency: "EUR",
    counterparty: booking.counterparty ?? "Example counterparty",
    description: booking.description ?? `Synthetic ${booking.reference}`
  })), []);
}

async function byReference(db: Database, reference: string) {
  const booking = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, reference)).get();

  assert.ok(booking, reference);

  return booking;
}

async function listed(search = "") {
  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-09",
    ...(search ? {
      search
    } : {})
  })));

  return page.transactions;
}

async function expenses() {
  return (await readCashFlow(september, "EUR")).expenses;
}

test("a payee and description override survives a resync that changes the bank's text, and restoring the bank's text follows the bank again", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250,
    counterparty: "EXMPL MKT 123",
    description: "CARD 4711"
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: "Example Market",
    description: "Weekly groceries"
  });
  await sync(db, "checking", [{
    reference: "bank:1",
    date: "2026-09-04",
    amount: -1300,
    counterparty: "EXAMPLE MARKET GMBH",
    description: "CARD 4711 CORRECTED"
  }]);

  const [shown] = await listed();

  assert.deepEqual([shown.counterparty, shown.description, shown.source_counterparty, shown.source_description], ["Example Market", "Weekly groceries", "EXAMPLE MARKET GMBH", "CARD 4711 CORRECTED"]);
  // The bank keeps the identity, date and amount.
  assert.deepEqual([shown.booking_date, shown.amount_minor], ["2026-09-04", -1300]);
  assert.equal((await listed("weekly groceries")).length, 1);
  assert.equal((await listed("4711 corrected")).length, 0);

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: "EXAMPLE MARKET GMBH"
  });
  const stored = await byReference(db, "bank:1");

  assert.equal(stored.counterparty_override, null);
  assert.equal(stored.description_override, "Weekly groceries");
  assert.equal(await db.$count(schema.transactions), 1);
});

test("saving only a type stores no override, and a transaction entered in Ufer is not given one", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense"
  });
  assert.deepEqual([(await byReference(db, "bank:1")).counterparty_override, (await byReference(db, "bank:1")).description_override], [null, null]);

  const { id: cash } = await createManualAccount({
    name: "Synthetic cash",
    institution: "Example institution",
    kind: "savings",
    currency: "EUR",
    balance: "100.00",
    date: "2026-09-01"
  }, now);
  const { id } = await enterManualTransaction(cash, {
    type: "expense",
    booking_date: "2026-09-05",
    amount: "-5.00",
    counterparty: "Example kiosk"
  }, now);

  await assert.rejects(updateTransactionDetails(id, {
    type: "expense",
    counterparty: "Renamed"
  }), ValidationError);
  await assert.rejects(hideTransaction(id, true, now), ValidationError);
});

test("a hidden synced booking stays hidden across resyncs and counts toward no cash flow until it is shown again", async context => {
  const db = await isolatedDatabase(context);
  const delivery = [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250
  }, {
    reference: "bank:duplicate",
    date: "2026-09-03",
    amount: -1250
  }];

  await sync(db, "checking", delivery);
  assert.equal(await expenses(), 2500);

  const duplicate = await byReference(db, "bank:duplicate");

  await hideTransaction(duplicate.id, true, now);
  await sync(db, "checking", delivery);

  assert.equal(await db.$count(schema.transactions), 2);
  assert.equal((await byReference(db, "bank:duplicate")).suppressed_at, now.toString());
  assert.equal(await expenses(), 1250);
  assert.deepEqual((await listed()).map(item => item.hidden).sort(), [false, true]);

  await hideTransaction(duplicate.id, false, now);
  assert.equal(await expenses(), 2500);
});

test("a hidden CSV booking leaves the manual account balance, and importing the same file again does not bring it back", async context => {
  const db = await isolatedDatabase(context);
  const { id: cash } = await createManualAccount({
    name: "Synthetic cash",
    institution: "Example institution",
    kind: "savings",
    currency: "EUR",
    balance: "100.00",
    date: "2026-09-01"
  }, now);
  const csv = "id,date,amount,currency,counterparty,description\nfee,2026-09-10,-20.00,EUR,Example bank,Synthetic fee\nfee-again,2026-09-10,-20.00,EUR,Example bank,Synthetic fee";
  const balance = async () => (await listAccounts()).find(account => account.id === cash)?.balance_minor;

  await importTransactions({
    account_id: cash,
    csv
  });
  assert.equal(await balance(), 6000);

  await hideTransaction((await byReference(db, "csv:fee-again")).id, true, now);
  await importTransactions({
    account_id: cash,
    csv
  });

  assert.equal(await balance(), 8000);
  assert.equal(await expenses(), 2000);
  assert.ok((await byReference(db, "csv:fee-again")).suppressed_at);
});

test("hiding a linked transfer releases its counterpart, and automatic pairing never links a hidden booking", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    reference: "bank:out",
    date: "2026-09-03",
    amount: -5000
  }]);
  await sync(db, "savings", [{
    reference: "bank:in",
    date: "2026-09-03",
    amount: 5000
  }]);
  const outgoing = await byReference(db, "bank:out");
  const incoming = await byReference(db, "bank:in");

  await updateTransactionDetails(outgoing.id, {
    type: "transfer",
    transfer: {
      counterpart_id: incoming.id
    }
  });
  assert.ok((await byReference(db, "bank:in")).transfer_id);

  await hideTransaction(outgoing.id, true, now);

  const released = await byReference(db, "bank:in");

  assert.deepEqual([released.transfer_id, released.type], [null, "income"]);
  assert.equal((await byReference(db, "bank:out")).transfer_id, null);

  // Even once both sides are plain transfers again, the hidden one is never paired.
  await db.update(schema.transactions).set({
    type: "transfer",
    transfer_source: "auto"
  });
  assert.equal(await pairTransfersInEnvironment("SANDBOX"), 0);
});

test("a hidden booking cannot be linked with another booking until it is shown again", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    reference: "bank:out",
    date: "2026-09-03",
    amount: -5000
  }]);
  await sync(db, "savings", [{
    reference: "bank:in",
    date: "2026-09-03",
    amount: 5000
  }]);
  const outgoing = await byReference(db, "bank:out");
  const incoming = await byReference(db, "bank:in");
  const link = () => updateTransactionDetails(outgoing.id, {
    type: "transfer",
    transfer: {
      counterpart_id: incoming.id
    }
  });

  await hideTransaction(outgoing.id, true, now);
  await assert.rejects(link(), (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.equal((await byReference(db, "bank:in")).transfer_id, null);
  assert.equal((await byReference(db, "bank:out")).type, "expense");

  await hideTransaction(outgoing.id, false, now);
  await link();
  assert.ok((await byReference(db, "bank:in")).transfer_id);
});

test("untouched source text with surrounding spaces stores no override", async context => {
  const db = await isolatedDatabase(context);

  await sync(db, "checking", [{
    reference: "bank:1",
    date: "2026-09-03",
    amount: -1250,
    counterparty: " Example Market ",
    description: "Card payment "
  }]);
  const booking = await byReference(db, "bank:1");

  await updateTransactionDetails(booking.id, {
    type: "expense",
    counterparty: " Example Market ",
    description: "Card payment "
  });

  const stored = await byReference(db, "bank:1");

  assert.deepEqual([stored.counterparty_override, stored.description_override], [null, null]);
});
