import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { saveAccountSync } from "../src/features/banking/server/account-sync-service";
import { finishSyncRun, startSyncRun } from "../src/features/banking/server/sync-repository";
import { listRecentSyncRuns } from "../src/features/banking/server/banking-queries";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import type { Entry } from "../src/features/transactions/server/transaction-entry";

async function isolatedDatabase(context: TestContext) {
  const client = await initializeDatabase(createClient({
    url: ":memory:"
  }));
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;
  const db = drizzle(client, {
    schema
  });

  context.after(() => {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

  return db;
}

const balances = [{
  balance_type: "CLBD",
  balance_amount: {
    amount: "100.00",
    currency: "EUR"
  },
  reference_date: "2026-03-10"
}];

function entry(reference: string, amount = -100): Entry {
  return {
    reference: `bank:${reference}`,
    date: "2026-03-01",
    amount,
    currency: "EUR",
    counterparty: "Example payee",
    description: "Synthetic purchase"
  };
}

async function createdAt(db: Database, reference: string) {
  const row = await db.$client.execute({
    sql: "SELECT created_at FROM transactions WHERE provider_reference=?",
    args: [`bank:${reference}`]
  });

  return row.rows[0].created_at;
}

async function insertedCount(db: Database, id: string) {
  const row = await db.$client.execute({
    sql: "SELECT inserted_count FROM sync_runs WHERE id=?",
    args: [id]
  });

  return row.rows[0].inserted_count;
}

test("a sync stamps only the rows it inserts with its start, and its count matches those rows", async context => {
  const db = await isolatedDatabase(context);
  const first = {
    environment: "SANDBOX",
    startedAt: "2026-03-10T08:00:00.000Z"
  };

  await db.$client.batch([
    "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('bank','SANDBOX','Synthetic account','Example institution','checking')",
    "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('production','PRODUCTION','Synthetic account','Example institution','checking')",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,created_at,type) VALUES('earlier','bank','bank:earlier','2026-02-01',-100,'EUR','2026-02-01T09:30:00.123Z','expense')",
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,created_at,type) VALUES('csv','bank','csv:file-1','2026-03-01',-100,'EUR','${first.startedAt}','expense')`,
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,created_at,type) VALUES('foreign','production','bank:foreign','2026-03-01',-100,'EUR','${first.startedAt}','expense')`
  ], "write");

  await startSyncRun(db, "SANDBOX", "first", first.startedAt);
  assert.equal(await saveAccountSync(db, first, "bank", "EUR", balances, [entry("earlier", -900), entry("one"), entry("two")], []), 2);
  await finishSyncRun(db, "first", "SUCCESS", null);

  assert.equal(await createdAt(db, "earlier"), "2026-02-01T09:30:00.123Z");
  assert.equal((await db.$client.execute("SELECT amount_minor FROM transactions WHERE id='earlier'")).rows[0].amount_minor, -900);
  assert.equal(await createdAt(db, "one"), first.startedAt);
  assert.equal(await insertedCount(db, "first"), 2);

  // A run whose lease expired keeps writing until its next heartbeat; its rows still belong to it, not to the run that took over.
  const stalled = {
    environment: "SANDBOX",
    startedAt: "2026-03-10T09:00:00.000Z"
  };
  const takeover = {
    environment: "SANDBOX",
    startedAt: "2026-03-10T09:15:00.000Z"
  };

  await startSyncRun(db, "SANDBOX", "stalled", stalled.startedAt);
  assert.equal(await saveAccountSync(db, stalled, "bank", "EUR", balances, [entry("one"), entry("three")], []), 1);
  await startSyncRun(db, "SANDBOX", "takeover", takeover.startedAt);
  assert.equal(await insertedCount(db, "stalled"), 1);
  assert.equal(await saveAccountSync(db, stalled, "bank", "EUR", balances, [entry("four")], []), 2);
  assert.equal(await saveAccountSync(db, takeover, "bank", "EUR", balances, [entry("one"), entry("three"), entry("four"), entry("five")], []), 1);
  await finishSyncRun(db, "takeover", "SUCCESS", null);
  await finishSyncRun(db, "stalled", "FAILED", "Sync interrupted.");

  assert.equal(await createdAt(db, "four"), stalled.startedAt);
  assert.equal(await createdAt(db, "five"), takeover.startedAt);
  assert.equal(await insertedCount(db, "stalled"), 2);
  assert.equal(await insertedCount(db, "takeover"), 1);
});

test("sync history reports linked rows, so runs recorded before stamping and empty runs offer no list", async context => {
  const db = await isolatedDatabase(context);
  const linked = {
    environment: "SANDBOX",
    startedAt: "2026-03-10T08:00:00.000Z"
  };

  await db.$client.batch([
    "INSERT INTO accounts(id,environment,name,institution,kind) VALUES('bank','SANDBOX','Synthetic account','Example institution','checking')",
    "INSERT INTO sync_runs(id,environment,started_at,finished_at,status,inserted_count) VALUES('legacy','SANDBOX','2026-03-01T08:00:00.000Z','2026-03-01T08:00:05.000Z','SUCCESS',3)",
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,created_at,type) VALUES('legacy-row','bank','bank:legacy','2026-03-01',-100,'EUR','2026-03-01T08:00:02.481Z','expense')",
    "INSERT INTO sync_runs(id,environment,started_at,finished_at,status,inserted_count) VALUES('empty','SANDBOX','2026-03-05T08:00:00.000Z','2026-03-05T08:00:05.000Z','SUCCESS',0)"
  ], "write");
  await startSyncRun(db, "SANDBOX", "linked", linked.startedAt);
  await saveAccountSync(db, linked, "bank", "EUR", balances, [entry("legacy"), entry("new")], []);
  await finishSyncRun(db, "linked", "SUCCESS", null);

  const runs = Object.fromEntries((await listRecentSyncRuns()).map(run => [run.id, {
    inserted: run.inserted_count,
    linked: run.linked_count
  }]));

  assert.deepEqual(runs, {
    linked: {
      inserted: 1,
      linked: 1
    },
    empty: {
      inserted: 0,
      linked: 0
    },
    legacy: {
      inserted: 3,
      linked: 0
    }
  });
});

test("the run filter lists exactly the run's rows across months and currencies within the current environment", async context => {
  const db = await isolatedDatabase(context);
  const started = "2026-03-10T08:00:00.000Z";

  await db.$client.batch([
    "INSERT INTO accounts(id,environment,name,institution,kind,currency) VALUES('eur','SANDBOX','Synthetic euro account','Example institution','checking','EUR')",
    "INSERT INTO accounts(id,environment,name,institution,kind,currency) VALUES('usd','SANDBOX','Synthetic dollar account','Example institution','checking','USD')",
    "INSERT INTO accounts(id,environment,name,institution,kind,currency) VALUES('production','PRODUCTION','Synthetic account','Example institution','checking','EUR')",
    `INSERT INTO sync_runs(id,environment,started_at,status,inserted_count) VALUES('run','SANDBOX','${started}','SUCCESS',3)`,
    `INSERT INTO sync_runs(id,environment,started_at,status,inserted_count) VALUES('production-run','PRODUCTION','${started}','SUCCESS',1)`,
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,created_at,type) VALUES('january','eur','bank:1','2026-01-05',-100,'EUR','Grocer','${started}','expense')`,
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,created_at,type) VALUES('march','eur','bank:2','2026-03-05',-100,'EUR','Bakery','${started}','expense')`,
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,created_at,type) VALUES('dollar','usd','bank:3','2026-02-01',-100,'USD','Hotel','${started}','expense')`,
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,created_at,type) VALUES('csv','eur','csv:4','2026-03-06',-100,'EUR','Bakery','${started}','expense')`,
    "INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,created_at,type) VALUES('other-run','eur','bank:5','2026-03-07',-100,'EUR','Bakery','2026-03-09T08:00:00.000Z','expense')",
    `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,created_at,type) VALUES('foreign','production','bank:6','2026-03-05',-100,'EUR','Bakery','${started}','expense')`
  ], "write");

  async function list(query: Record<string, string>) {
    const page = await readTransactionPage(dashboardFilters(new URLSearchParams(query)));

    return {
      run: page.syncRun?.id ?? null,
      count: page.transactionCount,
      ids: page.transactions.map(transaction => transaction.id).sort()
    };
  }

  assert.deepEqual(await list({
    syncRun: "run",
    period: "2026-03"
  }), {
    run: "run",
    count: 3,
    ids: ["dollar", "january", "march"]
  });
  assert.deepEqual((await list({
    syncRun: "run",
    search: "bak"
  })).ids, ["march"]);
  assert.deepEqual((await list({
    syncRun: "run",
    account: "usd"
  })).ids, ["dollar"]);
  assert.deepEqual((await list({
    period: "2026-03"
  })).ids, ["csv", "march", "other-run"]);
  assert.deepEqual(await list({
    syncRun: "production-run"
  }), {
    run: null,
    count: 0,
    ids: []
  });
  assert.deepEqual(await list({
    syncRun: "unknown"
  }), {
    run: null,
    count: 0,
    ids: []
  });

  process.env.ENABLE_BANKING_ENVIRONMENT = "PRODUCTION";
  assert.deepEqual((await list({
    syncRun: "production-run"
  })).ids, ["foreign"]);
});
