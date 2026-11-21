import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { HttpError, ValidationError } from "../src/lib/errors";
import { applyRulesToUncorrectedTransactions, updateRuleDetails, updateRuleEnabled } from "../src/features/categorization/server/categorization-service";
import { listRuleSummaries } from "../src/features/categorization/server/categorization-queries";

const editedDetails = {
  name: "Everyday purchases",
  pattern: "STORE",
  mode: "keyword",
  category_id: "leisure",
  priority: 25
};

async function ruleDatabase(context: TestContext) {
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
  await db.insert(schema.categorizationRules).values({
    id: "edited-rule",
    name: "Old purchases",
    pattern: "MARKET",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    enabled: 0
  });
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  });
  await db.insert(schema.transactions).values((["manual", "rule"] as const).map(source => ({
    id: `booking-${source}`,
    account_id: "checking",
    provider_reference: `synthetic-${source}`,
    booking_date: "2026-01-01",
    amount_minor: -1000,
    currency: "EUR",
    counterparty: "Example Store",
    category_id: "groceries",
    category_source: source,
    type: "expense" as const
  })));

  return db;
}

async function storedRule(db: Database) {
  return db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "edited-rule")).get();
}

test("editing a rule preserves its identity, age and disabled state and does not recategorize existing bookings", async context => {
  const db = await ruleDatabase(context);
  const ageBefore = await db.$client.execute("SELECT rowid FROM categorization_rules WHERE id='edited-rule'");
  const transactionsBefore = await db.select().from(schema.transactions);

  await updateRuleDetails("edited-rule", editedDetails);

  assert.deepEqual(await storedRule(db), {
    id: "edited-rule",
    ...editedDetails,
    enabled: 0,
    transaction_type: null,
    transfer_account_id: null
  });
  assert.deepEqual(await db.$client.execute("SELECT rowid FROM categorization_rules WHERE id='edited-rule'"), ageBefore);
  assert.equal((await db.select().from(schema.categorizationRules)).length, 1);
  assert.deepEqual(await db.select().from(schema.transactions), transactionsBefore);
  const summary = (await listRuleSummaries())[0];

  assert.equal(summary.category_id, "leisure");
  assert.equal(summary.category_name, "Leisure");
});

test("invalid rule edits and missing categories leave the rule unchanged", async context => {
  const db = await ruleDatabase(context);
  const before = await storedRule(db);

  await assert.rejects(updateRuleDetails("edited-rule", {
    ...editedDetails,
    mode: "regex",
    pattern: "("
  }), ValidationError);
  await assert.rejects(updateRuleDetails("edited-rule", {
    ...editedDetails,
    category_id: "missing"
  }), ValidationError);
  await assert.rejects(updateRuleDetails("edited-rule", {
    ...editedDetails,
    priority: -1
  }), z.ZodError);
  await assert.rejects(updateRuleDetails("edited-rule", {
    ...editedDetails,
    enabled: true
  }), z.ZodError);
  assert.deepEqual(await storedRule(db), before);
  await assert.rejects(updateRuleDetails("edited-rule", {
    ...editedDetails,
    apply_to_uncategorized: true
  }), z.ZodError);
  await assert.rejects(updateRuleDetails("missing-rule", editedDetails), (error: unknown) => error instanceof HttpError && error.status === 404);
});

test("an edited rule affects existing automatic assignments only after an explicit apply and keeps manual corrections", async context => {
  const db = await ruleDatabase(context);

  await updateRuleEnabled("edited-rule", {
    enabled: true
  });
  await updateRuleDetails("edited-rule", editedDetails);
  assert.equal((await storedRule(db))?.enabled, 1);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "booking-rule")).get())?.category_id, "groceries");
  await applyRulesToUncorrectedTransactions();
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "booking-rule")).get())?.category_id, "leisure");
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "booking-manual")).get())?.category_id, "groceries");
});
