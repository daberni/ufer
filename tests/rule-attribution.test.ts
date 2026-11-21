import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { asc } from "drizzle-orm";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { applyRulesToUncorrectedTransactions, createRule, deleteCategory, deleteRule } from "../src/features/categorization/server/categorization-service";
import { listRules } from "../src/features/categorization/server/rule-repository";
import { categorizeEntries } from "../src/features/categorization/server/rule-assignment";
import { upsertTransactions } from "../src/features/transactions/server/transaction-repository";
import { updateTransactionCategory } from "../src/features/transactions/server/transaction-service";

async function attributionDatabase(context: TestContext) {
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
  await db.insert(schema.categorizationRules).values([{
    id: "market-rule",
    name: "Markets",
    pattern: "MARKET",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    enabled: 1
  }, {
    id: "store-rule",
    name: "Stores",
    pattern: "STORE",
    mode: "keyword",
    category_id: "groceries",
    priority: 200,
    enabled: 1
  }]);
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    kind: "checking"
  });

  return db;
}

async function insertBooking(db: Database, id: string, counterparty: string) {
  await db.insert(schema.transactions).values({
    id,
    account_id: "checking",
    provider_reference: `synthetic-${id}`,
    date: "2026-01-01",
    amount_minor: -1000,
    currency: "EUR",
    counterparty,
    type: "expense"
  });
}

async function attributions(db: Database) {
  const rows = await db.select({
    id: schema.transactions.id,
    category: schema.transactions.category_id,
    source: schema.transactions.category_source,
    rule: schema.transactions.category_rule_id
  }).from(schema.transactions).orderBy(asc(schema.transactions.id));

  return rows.map(row => `${row.id}:${row.category}:${row.source}:${row.rule}`);
}

test("applying rules records the deciding rule, follows a changed decision with the same category and leaves manual assignments unattributed", async context => {
  const db = await attributionDatabase(context);

  await insertBooking(db, "market", "Example Market Store");
  await insertBooking(db, "other", "Example Bakery");

  await applyRulesToUncorrectedTransactions();
  assert.deepEqual(await attributions(db), ["market:groceries:rule:market-rule", "other:null:rule:null"]);

  // The category stays the same, but another rule now decides it.
  await db.$client.execute("UPDATE categorization_rules SET enabled=CASE id WHEN 'store-rule' THEN 1 ELSE 0 END");

  // The category stays, so nothing is reported as updated, but the deciding rule is recorded.
  assert.deepEqual(await applyRulesToUncorrectedTransactions(), {
    updated: 0,
    retyped: 0
  });
  assert.deepEqual(await attributions(db), ["market:groceries:rule:store-rule", "other:null:rule:null"]);

  await updateTransactionCategory("market", {
    category_id: "leisure"
  });
  await db.$client.execute("UPDATE categorization_rules SET enabled=1");
  await applyRulesToUncorrectedTransactions();
  assert.deepEqual(await attributions(db), ["market:leisure:manual:null", "other:null:rule:null"]);
});

test("a new rule applied to uncategorized bookings records itself", async context => {
  const db = await attributionDatabase(context);

  await insertBooking(db, "bakery", "Example Bakery");

  const result = await createRule({
    name: "Bakeries",
    pattern: "BAKERY",
    mode: "keyword",
    category_id: "groceries",
    apply_to_uncategorized: true
  });
  const created = (await listRules()).find(rule => rule.name === "Bakeries");

  assert.equal(result.categorized, 1);
  assert.deepEqual(await attributions(db), [`bakery:groceries:rule:${created?.id}`]);
});

test("a delivery records its deciding rule and keeps a manual assignment unattributed", async context => {
  const db = await attributionDatabase(context);
  const entries = [{
    reference: "synthetic-delivered",
    date: "2026-01-02",
    amount: -1500,
    currency: "EUR",
    counterparty: "Example Market",
    description: ""
  }];
  const deliver = async () => {
    const categorized = categorizeEntries(entries, await listRules());

    await db.transaction(tx => upsertTransactions(tx, "checking", categorized));
  };

  await deliver();
  const [delivered] = await db.select().from(schema.transactions);

  assert.equal(delivered.category_rule_id, "market-rule");

  await updateTransactionCategory(delivered.id, {
    category_id: "groceries"
  });
  await deliver();
  assert.deepEqual(await attributions(db), [`${delivered.id}:groceries:manual:null`]);
});

test("deleting the assigning rule keeps the category and leaves it unattributed", async context => {
  const db = await attributionDatabase(context);

  await insertBooking(db, "market", "Example Market");
  await applyRulesToUncorrectedTransactions();
  await deleteRule("market-rule");

  assert.deepEqual(await attributions(db), ["market:groceries:rule:null"]);
});

test("deleting a category without a replacement deletes its rules and their references, and a replacement keeps them", async context => {
  const db = await attributionDatabase(context);

  await db.$client.execute("UPDATE categorization_rules SET category_id='leisure' WHERE id='store-rule'");
  await insertBooking(db, "market", "Example Market");
  await insertBooking(db, "store", "Example Store");
  await applyRulesToUncorrectedTransactions();

  await deleteCategory("leisure", {
    replacement_id: "groceries"
  });
  assert.deepEqual(await attributions(db), ["market:groceries:rule:market-rule", "store:groceries:rule:store-rule"]);

  await deleteCategory("groceries", {
    replacement_id: null
  });
  assert.deepEqual(await attributions(db), ["market:null:rule:null", "store:null:rule:null"]);
});

test("deleting a category without a replacement clears references of its rules on bookings they assigned to another category", async context => {
  const db = await attributionDatabase(context);

  await insertBooking(db, "market", "Example Market");
  await applyRulesToUncorrectedTransactions();
  // The rule is retargeted after it assigned the booking, which keeps its earlier category.
  await db.$client.execute("UPDATE categorization_rules SET category_id='leisure' WHERE id='market-rule'");

  await deleteCategory("leisure", {
    replacement_id: null
  });

  assert.deepEqual(await attributions(db), ["market:groceries:rule:null"]);
});

async function assignManually(db: Database, id: string, counterparty: string, categoryId: string) {
  await insertBooking(db, id, counterparty);
  await updateTransactionCategory(id, {
    category_id: categoryId
  });
}

async function createRuleFrom(sourceTransactionId: string, pattern: string, categoryId: string) {
  const result = await createRule({
    name: pattern,
    pattern,
    mode: "keyword",
    category_id: categoryId,
    source_transaction_id: sourceTransactionId
  });
  const created = (await listRules()).find(rule => rule.name === pattern);

  return {
    result,
    ruleId: created?.id
  };
}

test("a rule created from a manual assignment takes over that transaction when it decides the same category, and only that one", async context => {
  const db = await attributionDatabase(context);

  await assignManually(db, "bakery", "Example Bakery", "groceries");
  await assignManually(db, "other-bakery", "Other Bakery", "groceries");

  const {
    result,
    ruleId
  } = await createRuleFrom("bakery", "BAKERY", "groceries");

  assert.equal(result.categorized, 0);
  assert.deepEqual(await attributions(db), [`bakery:groceries:rule:${ruleId}`, "other-bakery:groceries:manual:null"]);
});

test("the source transaction stays manual when the new rule does not match it, assigns another category or is overridden by an earlier rule", async context => {
  const db = await attributionDatabase(context);

  await assignManually(db, "unmatched", "Example Bakery", "groceries");
  await assignManually(db, "other-category", "Example Cafe", "groceries");
  // The earlier market rule decides this booking with groceries, so a later rule cannot take it over.
  await assignManually(db, "overridden", "Example Market Bakery", "leisure");

  await createRuleFrom("unmatched", "CAFE", "groceries");
  await createRuleFrom("other-category", "EXAMPLE CAFE", "leisure");
  await createRuleFrom("overridden", "BAKERY", "leisure");

  assert.deepEqual(await attributions(db), ["other-category:groceries:manual:null", "overridden:leisure:manual:null", "unmatched:groceries:manual:null"]);
});
