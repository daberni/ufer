import { seedActor } from "./fixtures/auth";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { eq, like, not } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { buildDemoDataset } from "../src/features/demo/server/demo-dataset";
import { DemoSeedRefusal, seedDemoData } from "../src/features/demo/server/demo-seed-service";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { pairAllTransfers } from "../src/features/transactions/server/transfer-pairing-repository";
import { listSyncAccounts } from "../src/features/banking/server/sync-repository";

const firstRun = Temporal.PlainDate.from("2026-11-16");
const secondRun = Temporal.PlainDate.from("2026-12-01");

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

async function insertSandboxBankAccount(db: Database) {
  await db.insert(schema.requisitions).values({
    id: "sandbox-connection",
    bank_name: "Example sandbox bank",
    bank_country: "AT",
    status: "AUTHORIZED"
  });
  await db.insert(schema.accounts).values({
    id: "sandbox-account",
    name: "Sandbox checking",
    institution: "Example sandbox bank",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "sandbox-uid",
    requisition_id: "sandbox-connection",
    balance_minor: 50000,
    balance_date: "2026-11-01"
  });
  await db.insert(schema.transactions).values({
    id: "sandbox-transaction",
    account_id: "sandbox-account",
    provider_reference: "bank:sandbox-reference",
    booking_date: "2026-11-01",
    amount_minor: -1999,
    currency: "EUR",
    type: "expense",
    counterparty: "Example shop",
    description: "Sandbox purchase"
  });
}

async function insertManualAccount(db: Database, id: string) {
  await db.insert(schema.accounts).values({
    id,
    name: "Reviewer asset",
    institution: "Example institution",
    kind: "property"
  });
  await db.insert(schema.transactions).values({
    id: `${id}-opening`,
    account_id: id,
    provider_reference: `manual:${id}-opening`,
    booking_date: "2026-10-01",
    amount_minor: 1000000,
    currency: "EUR",
    type: "opening_balance",
    type_source: "manual"
  });
}

async function demoTransactions(db: Database) {
  return db.select().from(schema.transactions).where(like(schema.transactions.account_id, "demo-%"));
}

async function foreignRows(db: Database) {
  return {
    accounts: await db.select().from(schema.accounts).where(not(like(schema.accounts.id, "demo-%"))),
    transactions: await db.select().from(schema.transactions).where(not(like(schema.transactions.account_id, "demo-%"))),
    snapshots: await db.select().from(schema.balanceSnapshots).where(not(like(schema.balanceSnapshots.account_id, "demo-%"))),
    rules: await db.select().from(schema.categorizationRules).where(not(like(schema.categorizationRules.id, "demo-%"))),
    requisitions: await db.select().from(schema.requisitions).where(not(like(schema.requisitions.id, "demo-%"))),
    syncRuns: await db.select().from(schema.syncRuns).where(not(like(schema.syncRuns.id, "demo-%"))),
    users: await db.select().from(schema.authUsers)
  };
}

test("re-running the demo seed replaces only demo rows and keeps bank-connected and other rows", async context => {
  const db = await isolatedDatabase(context);

  await seedActor(db);
  await insertSandboxBankAccount(db);
  await insertManualAccount(db, "reviewer-asset");
  await db.insert(schema.categories).values({
    id: "reviewer-dining",
    name: "dining",
    color: "#123456"
  });
  await db.insert(schema.categorizationRules).values({
    id: "reviewer-rule",
    name: "Reviewer rule",
    pattern: "Example shop",
    mode: "keyword",
    category_id: "leisure"
  });

  await seedDemoData({
    confirmed: true,
    runDate: firstRun
  });

  // Rows that appear between runs: a sandbox sync categorized by a demo rule and a reviewer's change on a demo account.
  await db.update(schema.transactions).set({
    category_id: "demo-travel"
  }).where(eq(schema.transactions.id, "sandbox-transaction"));
  await db.insert(schema.transactions).values({
    id: "reviewer-import-on-demo-account",
    account_id: "demo-checking",
    provider_reference: "csv:reviewer",
    booking_date: "2026-11-10",
    amount_minor: -500,
    currency: "EUR",
    type: "expense"
  });

  const before = await foreignRows(db);
  const summary = await seedDemoData({
    confirmed: true,
    runDate: secondRun
  });
  const after = await foreignRows(db);
  const dataset = buildDemoDataset(secondRun);
  const expected = dataset.accounts.reduce((total, account) => total + account.entries.length, dataset.createdCounterparts.length);
  const seeded = await demoTransactions(db);
  const balanceBookings = seeded.filter(row => row.type === "opening_balance" || row.type === "adjustment");
  const balances = new Map((await listAccounts()).map(account => [account.id, account.balance_minor]));
  const lastValuation = (id: string) => dataset.accounts.find(account => account.id === id)?.valuations.at(-1)?.amount;
  const demoAccounts = await db.select().from(schema.accounts).where(like(schema.accounts.id, "demo-%"));
  const diningRule = await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "demo-rule-dining")).get();

  assert.deepEqual(after, before);
  assert.equal(after.transactions.find(row => row.id === "sandbox-transaction")?.category_id, "demo-travel");
  assert.equal(summary.transactions, expected + balanceBookings.length);
  assert.equal(seeded.length, expected + balanceBookings.length);
  assert.equal(balanceBookings.filter(row => row.type === "opening_balance").length, 10);
  // Counterparts the seed creates on a manual account carry their source booking in the reference, as when a person creates them; balances are booked as a person enters them.
  assert.ok(seeded.every(row => ["demo:", "transfer:", "manual:"].some(prefix => row.provider_reference.startsWith(prefix))));
  assert.equal(demoAccounts.length, 10);
  // Market values end on their last valuation; every other balance follows from the transactions.
  assert.equal(balances.get("demo-investment"), lastValuation("demo-investment"));
  assert.equal(balances.get("demo-property"), lastValuation("demo-property"));
  assert.equal(balances.get("demo-car"), lastValuation("demo-car"));
  const manualAccounts = demoAccounts.filter(account => account.provider === "manual");
  const bankAccounts = demoAccounts.filter(account => account.provider === "enable_banking");

  assert.deepEqual(bankAccounts.map(account => account.id).sort(), ["demo-checking", "demo-credit-card", "demo-joint", "demo-online-checking", "demo-savings"]);
  assert.ok(manualAccounts.every(account => account.balance_minor === null && typeof balances.get(account.id) === "number"));
  const reported = new Map((await db.select().from(schema.balanceSnapshots).where(like(schema.balanceSnapshots.account_id, "demo-%"))).map(row => [row.account_id, row.amount_minor]));

  // A simulated connection reports the balance the transactions add up to, as after a sync that matched; the deprecated balance columns stay empty.
  assert.ok(bankAccounts.every(account => account.requisition_id?.startsWith("demo-connection-") && account.last_synced_at !== null && account.balance_minor === null && reported.get(account.id) === balances.get(account.id)));
  // The latest sync run lies before the run date, so it is never in the future.
  assert.ok(bankAccounts.every(account => account.last_synced_at !== null && account.last_synced_at < "2026-12-01"));
  // A category someone created with the same name is reused instead of adding a conflicting demo category.
  assert.equal(diningRule?.category_id, "reviewer-dining");
  assert.equal(await db.select().from(schema.categories).where(eq(schema.categories.id, "demo-dining")).get(), undefined);
});

test("the guard refuses missing confirmation, production banking and real-looking databases without writing", async context => {
  const db = await isolatedDatabase(context);

  await assert.rejects(seedDemoData({
    confirmed: false,
    runDate: firstRun
  }), DemoSeedRefusal);
  assert.equal((await demoTransactions(db)).length, 0);

  process.env.ENABLE_BANKING_ENVIRONMENT = "PRODUCTION";
  await assert.rejects(seedDemoData({
    confirmed: true,
    runDate: firstRun
  }), DemoSeedRefusal);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";

  await insertSandboxBankAccount(db);
  await seedDemoData({
    confirmed: true,
    runDate: firstRun
  });
  const seeded = await demoTransactions(db);

  await insertManualAccount(db, "own-checking");
  await db.insert(schema.transactions).values({
    id: "own-transaction",
    account_id: "own-checking",
    provider_reference: "csv:own",
    booking_date: "2026-11-02",
    amount_minor: -4200,
    currency: "EUR",
    type: "expense"
  });
  await assert.rejects(seedDemoData({
    confirmed: true,
    runDate: secondRun
  }), /1 transactions on manual or CSV accounts/);
  assert.deepEqual(await demoTransactions(db), seeded);
});

test("the dataset is reproducible for a run date, its rules categorize all but a handful of rows and its transfers are linked in pairs", async context => {
  const db = await isolatedDatabase(context);

  assert.deepEqual(buildDemoDataset(firstRun), buildDemoDataset(firstRun));

  const summary = await seedDemoData({
    confirmed: true,
    runDate: firstRun
  });
  const rows = await demoTransactions(db);
  const dates = rows.map(row => row.booking_date).sort();
  const transfers = rows.filter(row => row.type === "transfer");
  const untracked = transfers.filter(row => row.transfer_id === null);
  const linkedTransfers = transfers.filter(row => row.transfer_id !== null);
  const transferIds = new Set(linkedTransfers.map(row => row.transfer_id));
  const created = rows.filter(row => row.provider_reference.startsWith("transfer:"));
  const createdSources = rows.filter(row => created.some(counterpart => counterpart.transfer_id === row.transfer_id && counterpart.id !== row.id));

  assert.ok(summary.transactions > 1000);
  const uncategorizedSpending = rows.filter(row => (row.type === "income" || row.type === "expense") && row.category_id === null).length;

  assert.ok(uncategorizedSpending >= 5 && uncategorizedSpending <= 15, `${uncategorizedSpending} uncategorized income/expense rows`);
  assert.equal(dates[0] >= "2025-05-16", true);
  assert.equal(dates[dates.length - 1] <= "2026-11-16", true);
  // Three kinds of transfers: pairs between demo accounts, counterparts created on the manual mortgage account, and transfers to an untracked account.
  assert.ok(transferIds.size > created.length);
  assert.equal(linkedTransfers.reduce((total, row) => total + row.amount_minor, 0), 0);
  assert.equal(transferIds.size * 2, linkedTransfers.length);
  assert.equal(created.length, buildDemoDataset(firstRun).createdCounterparts.length);
  assert.ok(created.length >= 2);
  assert.ok(created.every(row => row.account_id === "demo-loan" && row.amount_minor > 0 && row.transfer_id !== null));
  assert.equal(createdSources.length, created.length);
  assert.ok(untracked.length >= 12);
  assert.ok(untracked.every(row => row.counterparty === "Junior savings account"));
  assert.ok(transfers.every(row => row.category_id === null));
});

test("re-seeding keeps a person's rule-set transfer to a removed demo account unpairable instead of pairing it with any account", async context => {
  const db = await isolatedDatabase(context);

  await seedActor(db);
  await insertSandboxBankAccount(db);
  await insertManualAccount(db, "reviewer-asset");
  await seedDemoData({
    confirmed: true,
    runDate: firstRun
  });
  await db.insert(schema.transactions).values({
    id: "rule-transfer",
    account_id: "sandbox-account",
    provider_reference: "bank:rule-transfer",
    booking_date: "2025-01-10",
    amount_minor: -7000,
    currency: "EUR",
    type: "transfer",
    type_rule_id: "reviewer-rule",
    type_transfer_account_id: "demo-checking"
  });
  await seedDemoData({
    confirmed: true,
    runDate: secondRun
  });
  await db.insert(schema.transactions).values({
    id: "other-side",
    account_id: "reviewer-asset",
    provider_reference: "manual:other-side",
    booking_date: "2025-01-10",
    amount_minor: 7000,
    currency: "EUR",
    type: "income"
  });
  await pairAllTransfers();

  const booking = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "rule-transfer")).get();

  assert.equal(booking?.type_transfer_account_id, "removed:demo-checking");
  assert.equal(booking?.transfer_id, null);
});

test("simulated bank connections show a sync history and splits but are never synced", async context => {
  const db = await isolatedDatabase(context);

  await insertSandboxBankAccount(db);
  await db.update(schema.requisitions).set({
    status: "LINKED"
  }).where(eq(schema.requisitions.id, "sandbox-connection"));
  await seedDemoData({
    confirmed: true,
    runDate: firstRun
  });
  await seedDemoData({
    confirmed: true,
    runDate: secondRun
  });

  const connections = await db.select().from(schema.requisitions).where(like(schema.requisitions.id, "demo-%"));
  const runs = await db.select().from(schema.syncRuns).where(like(schema.syncRuns.id, "demo-%"));
  const splits = await db.select().from(schema.transactionSplits).innerJoin(schema.transactions, eq(schema.transactions.id, schema.transactionSplits.transaction_id));
  const splitBookings = new Map<string, number>();

  for (const row of splits) {
    splitBookings.set(row.transactions.id, (splitBookings.get(row.transactions.id) ?? 0) + row.transaction_splits.amount_minor);
  }

  assert.equal(connections.length, 3);
  assert.ok(connections.every(connection => connection.status === "LINKED" && connection.session_cipher === null));
  // Re-seeding replaces the history instead of adding to it; one run failed for a single account and the next succeeded.
  assert.equal(runs.length, 14);
  assert.deepEqual(runs.filter(run => run.status !== "SUCCESS").map(run => run.status), ["PARTIAL"]);
  assert.equal(splitBookings.size, 3);
  assert.ok(splits.every(row => row.transactions.category_id === null && row.transaction_splits.category_id !== null));
  assert.ok([...splitBookings].every(([id, total]) => splits.find(row => row.transactions.id === id)?.transactions.amount_minor === total));
  // A sync never requests demo accounts from a provider; a real sandbox connection stays syncable.
  assert.deepEqual((await listSyncAccounts()).map(account => account.id), ["sandbox-account"]);
});
