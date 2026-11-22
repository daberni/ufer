import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { hideTransaction, updateTransactionCategory } from "../src/features/transactions/server/transaction-service";
import { duplicateCandidates, markDuplicate } from "../src/features/transactions/server/duplicate-service";
import { readSyncRunTransactionPage } from "../src/features/banking/server/banking-queries";
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
    name: "Synthetic checking",
    kind: "checking",
    provider: "enable_banking"
  }, {
    id: "savings",
    name: "Synthetic savings",
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
async function sync(accountId: string, bookings: Booking[]) {
  await saveAccountSync({
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
    counterparty: booking.counterparty ?? "",
    description: booking.description ?? ""
  })), []);
}

async function byReference(db: Database, reference: string) {
  const booking = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, reference)).get();

  assert.ok(booking, reference);

  return booking;
}

async function expenses() {
  return (await readCashFlow(september, "EUR")).expenses;
}

async function listed() {
  const page = await readSyncRunTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-09"
  })));

  return page.transactions;
}

const shortCopy = {
  reference: "bank:short",
  date: "2026-09-03",
  amount: -1250,
  counterparty: "EXMPL"
};
const describedCopy = {
  reference: "bank:described",
  date: "2026-09-10",
  amount: -1250,
  counterparty: "Example Market",
  description: "Weekly groceries card payment"
};

test("naming the shorter copy a duplicate hides it, records the kept booking and counts the movement once, also after a resync", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [shortCopy, describedCopy]);
  assert.equal(await expenses(), 2500);

  const short = await byReference(db, shortCopy.reference);
  const described = await byReference(db, describedCopy.reference);

  await markDuplicate(short.id, {
    duplicate_of: described.id
  }, now);
  await sync("checking", [shortCopy, describedCopy]);

  const hidden = await byReference(db, shortCopy.reference);

  assert.equal(hidden.suppressed_at, now.toString());
  assert.equal(hidden.duplicate_of_id, described.id);
  assert.equal((await byReference(db, describedCopy.reference)).suppressed_at, null);
  assert.equal(await expenses(), 1250);
  assert.deepEqual((await listed()).find(item => item.id === short.id)?.duplicate_of, {
    id: described.id,
    date: describedCopy.date,
    counterparty: describedCopy.counterparty,
    description: describedCopy.description
  });

  await hideTransaction(described.id, true, now);

  assert.equal((await listed()).find(item => item.id === short.id)?.duplicate_of, null);
});

test("naming the better-described copy a duplicate of the shorter one still keeps the better-described copy and takes over the hidden copy's manual category", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [shortCopy, describedCopy]);
  const short = await byReference(db, shortCopy.reference);
  const described = await byReference(db, describedCopy.reference);

  await updateTransactionCategory(short.id, {
    category_id: "groceries"
  });
  await markDuplicate(described.id, {
    duplicate_of: short.id
  }, now);

  const kept = await byReference(db, describedCopy.reference);

  assert.equal(kept.suppressed_at, null);
  assert.deepEqual([kept.category_id, kept.category_source], ["groceries", "manual"]);
  assert.equal((await byReference(db, shortCopy.reference)).duplicate_of_id, described.id);
});

test("the kept copy's own manual category wins over the hidden copy's", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [shortCopy, describedCopy]);
  const short = await byReference(db, shortCopy.reference);
  const described = await byReference(db, describedCopy.reference);

  await updateTransactionCategory(short.id, {
    category_id: "groceries"
  });
  await updateTransactionCategory(described.id, {
    category_id: "leisure"
  });
  await markDuplicate(short.id, {
    duplicate_of: described.id
  }, now);

  assert.equal((await byReference(db, describedCopy.reference)).category_id, "leisure");
});

test("several equal candidates are all offered and none is resolved without naming one; other amounts, accounts and distant dates are no candidates", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [shortCopy, describedCopy, {
    ...describedCopy,
    reference: "bank:second",
    date: "2026-09-04"
  }, {
    ...describedCopy,
    reference: "bank:other-amount",
    amount: -1251
  }, {
    ...describedCopy,
    reference: "bank:distant",
    date: "2026-09-18"
  }]);
  await sync("savings", [{
    ...describedCopy,
    reference: "bank:other-account"
  }]);
  const short = await byReference(db, shortCopy.reference);
  const { candidates } = await duplicateCandidates(short.id);

  assert.deepEqual(candidates.map(candidate => candidate.id), [(await byReference(db, "bank:second")).id, (await byReference(db, describedCopy.reference)).id]);
  assert.ok(candidates.every(candidate => candidate.keeps_candidate));
  assert.equal((await byReference(db, shortCopy.reference)).suppressed_at, null);

  for (const reference of ["bank:other-amount", "bank:distant", "bank:other-account"]) {
    await assert.rejects(markDuplicate(short.id, {
      duplicate_of: (await byReference(db, reference)).id
    }, now), ValidationError, reference);
  }

  await assert.rejects(markDuplicate(short.id, {}, now), ZodError);
  assert.equal(await expenses(), 1250 * 5 + 1251);
});

test("showing a resolved duplicate again clears its record and counts it again; a hidden booking cannot be resolved", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [shortCopy, describedCopy]);
  const short = await byReference(db, shortCopy.reference);
  const described = await byReference(db, describedCopy.reference);

  await markDuplicate(short.id, {
    duplicate_of: described.id
  }, now);
  await assert.rejects(markDuplicate(described.id, {
    duplicate_of: short.id
  }, now), HttpError);

  await hideTransaction(short.id, false, now);

  assert.equal((await byReference(db, shortCopy.reference)).duplicate_of_id, null);
  assert.equal(await expenses(), 2500);
  assert.equal((await listed()).find(item => item.id === short.id)?.duplicate_of, null);
});

test("a CSV-imported copy beside a bank copy is deleted, and the bank copy takes over its better text and manual category", async context => {
  const db = await isolatedDatabase(context);

  await sync("checking", [shortCopy]);
  const bank = await byReference(db, shortCopy.reference);

  await db.insert(schema.transactions).values({
    ...bank,
    id: "csv-copy",
    provider_reference: "csv:m:synthetic-row",
    booking_date: null,
    date: describedCopy.date,
    counterparty: describedCopy.counterparty,
    description: describedCopy.description
  });
  await updateTransactionCategory("csv-copy", {
    category_id: "groceries"
  });

  const offered = await duplicateCandidates("csv-copy");

  assert.deepEqual(offered.candidates.map(candidate => [candidate.id, candidate.keeps_candidate, candidate.deletes_other]), [[bank.id, true, true]]);

  await markDuplicate("csv-copy", {
    duplicate_of: bank.id
  }, now);

  assert.equal(await db.select().from(schema.transactions).where(eq(schema.transactions.id, "csv-copy")).get(), undefined);

  await sync("checking", [shortCopy]);
  const kept = await byReference(db, shortCopy.reference);

  assert.equal(kept.suppressed_at, null);
  assert.equal(kept.counterparty_override, describedCopy.counterparty);
  assert.equal(kept.description_override, describedCopy.description);
  assert.equal(kept.category_id, "groceries");
  assert.equal(kept.category_source, "manual");
  assert.equal(await expenses(), 1250);
});
