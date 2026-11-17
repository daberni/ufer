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
    environment: "SANDBOX",
    bank_name: "Example sandbox bank",
    bank_country: "AT",
    status: "AUTHORIZED"
  });
  await db.insert(schema.accounts).values({
    id: "sandbox-account",
    environment: "SANDBOX",
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
    environment: "SANDBOX",
    name: "Reviewer asset",
    institution: "Example institution",
    kind: "property",
    balance_minor: 1000000,
    balance_date: "2026-10-01"
  });
  await db.insert(schema.balanceSnapshots).values({
    id: `${id}-snapshot`,
    account_id: id,
    observed_at: "2026-10-01",
    amount_minor: 1000000,
    source: "manual"
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
    requisitions: await db.select().from(schema.requisitions),
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
  const expected = buildDemoDataset(secondRun).accounts.reduce((total, account) => total + account.entries.length, 0);
  const seeded = await demoTransactions(db);
  const demoAccounts = await db.select().from(schema.accounts).where(like(schema.accounts.id, "demo-%"));
  const diningRule = await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "demo-rule-dining")).get();

  assert.deepEqual(after, before);
  assert.equal(after.transactions.find(row => row.id === "sandbox-transaction")?.category_id, "demo-travel");
  assert.equal(summary.transactions, expected);
  assert.equal(seeded.length, expected);
  assert.ok(seeded.every(row => row.provider_reference.startsWith("demo:")));
  assert.equal(demoAccounts.length, 6);
  assert.ok(demoAccounts.filter(account => account.kind !== "property").every(account => account.balance_date === "2026-12-01"));
  assert.ok(demoAccounts.every(account => account.environment === "SANDBOX" && account.provider === "manual"));
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

  await db.delete(schema.transactions).where(eq(schema.transactions.id, "own-transaction"));
  await db.insert(schema.accounts).values({
    id: "production-account",
    environment: "PRODUCTION",
    name: "Real checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "production-uid"
  });
  await assert.rejects(seedDemoData({
    confirmed: true,
    runDate: secondRun
  }), /outside the SANDBOX banking environment/);
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
  const transferIds = new Set(transfers.map(row => row.transfer_id));

  assert.ok(summary.transactions > 1000);
  assert.ok(summary.uncategorized >= 5 && summary.uncategorized <= 15, `${summary.uncategorized} uncategorized rows`);
  assert.equal(dates[0] >= "2025-05-16", true);
  assert.equal(dates[dates.length - 1] <= "2026-11-16", true);
  assert.equal(transfers.reduce((total, row) => total + row.amount_minor, 0), 0);
  assert.ok(transfers.every(row => row.transfer_id !== null && row.category_id === "transfer"));
  assert.equal(transferIds.size * 2, transfers.length);
});

test("seeding pairs transfers only among demo accounts and leaves a matching sandbox booking untouched", async context => {
  const db = await isolatedDatabase(context);
  const salaries = buildDemoDataset(firstRun).accounts.find(account => account.id === "demo-checking")?.entries.filter(entry => entry.description.startsWith("Salary")) ?? [];
  const salary = salaries[salaries.length - 1];

  assert.ok(salary);
  await insertSandboxBankAccount(db);
  // An unlinked sandbox transfer whose only opposite booking within three days is a demo salary.
  await db.insert(schema.transactions).values({
    id: "sandbox-transfer",
    account_id: "sandbox-account",
    provider_reference: "bank:sandbox-transfer",
    booking_date: salary.date,
    amount_minor: -salary.amount,
    currency: "EUR",
    type: "transfer",
    counterparty: "Example own account"
  });

  await seedDemoData({
    confirmed: true,
    runDate: firstRun
  });

  const sandboxTransfer = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "sandbox-transfer")).get();
  const demoSalary = await db.select().from(schema.transactions).where(eq(schema.transactions.provider_reference, salary.reference)).get();

  assert.deepEqual([sandboxTransfer?.type, sandboxTransfer?.transfer_id], ["transfer", null]);
  assert.deepEqual([demoSalary?.type, demoSalary?.transfer_id], ["income", null]);
});
