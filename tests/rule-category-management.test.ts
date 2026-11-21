import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { HttpError, ValidationError } from "../src/lib/errors";
import { categorize, prepareRules } from "../src/lib/rules";
import { monthPeriod } from "../src/lib/period";
import { applyRulesToUncorrectedTransactions, categoryUsage, createRule, updateRuleDetails, deleteCategory, deleteRule, previewRule, reorderRules } from "../src/features/categorization/server/categorization-service";
import { listRuleSummaries } from "../src/features/categorization/server/categorization-queries";
import { RuleLimitReached, appendRule, listRules } from "../src/features/categorization/server/rule-repository";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { orderedPriorities } from "../src/features/categorization/rule-order";

const january = monthPeriod(Temporal.PlainYearMonth.from("2026-01"));

type Booking = {
  id: string;
  counterparty: string;
  category_id: string | null;
  category_source: "rule" | "manual";
};

// Two rules match "Corner Market Cafe"; the market rule decides it while it comes first.
const bookings: Booking[] = [
  {
    id: "market-rule",
    counterparty: "Corner Market Cafe",
    category_id: "groceries",
    category_source: "rule"
  },
  {
    id: "market-manual",
    counterparty: "Corner Market Cafe",
    category_id: "groceries",
    category_source: "manual"
  },
  {
    id: "cinema-rule",
    counterparty: "Example Cinema",
    category_id: "leisure",
    category_source: "rule"
  },
  {
    id: "uncategorized-cafe",
    counterparty: "Harbour Cafe",
    category_id: null,
    category_source: "rule"
  }
];

async function managementDatabase(context: TestContext) {
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
  await db.insert(schema.categorizationRules).values([
    {
      id: "rule-market",
      name: "Market",
      pattern: "MARKET",
      mode: "keyword",
      category_id: "groceries",
      priority: 100,
      enabled: 1
    },
    {
      id: "rule-cafe",
      name: "Cafe",
      pattern: "CAFE",
      mode: "keyword",
      category_id: "leisure",
      priority: 100,
      enabled: 1
    },
    {
      id: "rule-cinema",
      name: "Cinema",
      pattern: "CINEMA",
      mode: "keyword",
      category_id: "leisure",
      priority: 200,
      enabled: 0
    }
  ]);
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  });
  await db.insert(schema.transactions).values(bookings.map(booking => ({
    ...booking,
    account_id: "checking",
    provider_reference: `synthetic-${booking.id}`,
    booking_date: "2026-01-10",
    amount_minor: -1000,
    currency: "EUR",
    type: "expense" as const
  })));

  return db;
}

async function categoryOf(db: Database, id: string) {
  return (await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get())?.category_id;
}

async function storedTransactions(db: Database) {
  return db.select().from(schema.transactions).orderBy(asc(schema.transactions.id));
}

async function storedRules(db: Database) {
  return db.select().from(schema.categorizationRules).orderBy(asc(schema.categorizationRules.id));
}

async function spendingByCategory() {
  const cashFlow = await readCashFlow(january, "EUR");

  return Object.fromEntries(cashFlow.expenseBreakdown.map(item => [item.categoryId ?? "uncategorized", item.amount]));
}

test("reordering stores distinct priorities in list order and keeps every other rule detail", async context => {
  const db = await managementDatabase(context);
  const before = await storedRules(db);

  await reorderRules({
    ids: ["rule-cinema", "rule-cafe", "rule-market"]
  });

  const summaries = await listRuleSummaries();

  assert.deepEqual(summaries.map(rule => rule.id), ["rule-cinema", "rule-cafe", "rule-market"]);
  assert.deepEqual(summaries.map(rule => rule.priority), [10, 20, 30]);
  const withoutPriority = (rules: typeof before) => rules.map(rule => [rule.id, rule.name, rule.pattern, rule.mode, rule.category_id, rule.enabled]);

  assert.deepEqual(withoutPriority(await storedRules(db)), withoutPriority(before));

  // A reload reads the same order from storage, and matching follows it.
  assert.deepEqual((await listRules()).map(rule => rule.id), ["rule-cinema", "rule-cafe", "rule-market"]);
  assert.equal(categorize({
    counterparty: "Corner Market Cafe",
    description: ""
  }, prepareRules(await listRules())), "leisure");
});

test("reordering never recategorizes existing transactions until rules are applied, and applying keeps manual assignments", async context => {
  const db = await managementDatabase(context);
  const before = await storedTransactions(db);

  await reorderRules({
    ids: ["rule-cafe", "rule-market", "rule-cinema"]
  });

  assert.deepEqual(await storedTransactions(db), before);

  await applyRulesToUncorrectedTransactions();

  assert.equal(await categoryOf(db, "market-rule"), "leisure");
  assert.equal(await categoryOf(db, "market-manual"), "groceries");
  assert.equal(await categoryOf(db, "uncategorized-cafe"), "leisure");
});

test("an order that does not list exactly the stored rules is rejected without changes", async context => {
  const db = await managementDatabase(context);
  const before = await storedRules(db);
  const isConflict = (error: unknown) => error instanceof HttpError && error.status === 409;

  await assert.rejects(reorderRules({
    ids: ["rule-cafe", "rule-market"]
  }), isConflict);
  await assert.rejects(reorderRules({
    ids: ["rule-cafe", "rule-market", "rule-unknown"]
  }), isConflict);
  await assert.rejects(reorderRules({
    ids: ["rule-cafe", "rule-cafe", "rule-market"]
  }), z.ZodError);
  assert.deepEqual(await storedRules(db), before);
});

test("ordered priorities stay distinct and within the editor's range for long rule lists", () => {
  assert.deepEqual(orderedPriorities(3), [10, 20, 30]);

  const many = orderedPriorities(4000);

  assert.equal(new Set(many).size, 4000);
  assert.ok(many.every((priority, index) => priority > 0 && priority <= 10000 && (index === 0 || priority > many[index - 1])));

});

test("deleting a rule keeps the categories it assigned until rules are applied", async context => {
  const db = await managementDatabase(context);

  await deleteRule("rule-market");

  assert.deepEqual((await storedRules(db)).map(rule => rule.id), ["rule-cafe", "rule-cinema"]);
  assert.equal(await categoryOf(db, "market-rule"), "groceries");
  await assert.rejects(deleteRule("rule-market"), (error: unknown) => error instanceof HttpError && error.status === 404);

  // Applying lets the next matching rule decide; the manual assignment stays.
  await applyRulesToUncorrectedTransactions();
  assert.equal(await categoryOf(db, "market-rule"), "leisure");
  assert.equal(await categoryOf(db, "market-manual"), "groceries");
});

test("previewing an edit counts the edited rule in place of its stored version", async context => {
  const db = await managementDatabase(context);
  const rulesBefore = await storedRules(db);

  // Stored, the market rule decides one automatic booking; as a lower-priority "CAFE" rule it loses to the cafe rule's ID tie-break.
  assert.deepEqual(await previewRule({
    pattern: "CAFE",
    mode: "keyword",
    priority: 100,
    rule_id: "rule-market"
  }), {
    id: "rule-market",
    enabled: true,
    matched: 0,
    uncategorized: 0,
    manual: 0,
    manual_same_category: 0
  });
  assert.deepEqual(await previewRule({
    pattern: "cafe\\b",
    mode: "regex",
    priority: 1,
    rule_id: "rule-market"
  }), {
    id: "rule-market",
    enabled: true,
    matched: 2,
    uncategorized: 1,
    manual: 1,
    manual_same_category: 0
  });
  await assert.rejects(previewRule({
    pattern: "CAFE",
    mode: "keyword",
    priority: 1,
    rule_id: "rule-missing"
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
  await assert.rejects(previewRule({
    pattern: "(",
    mode: "regex",
    priority: 1,
    rule_id: "rule-market"
  }), ValidationError);

  assert.deepEqual(await storedRules(db), rulesBefore);
});

test("deleting a category can move its transactions and rules to another category, and reports follow", async context => {
  const db = await managementDatabase(context);

  assert.deepEqual(await categoryUsage("groceries"), {
    transactions: 2,
    manual_transactions: 1,
    rules: 1
  });
  assert.deepEqual(await spendingByCategory(), {
    groceries: 2000,
    leisure: 1000,
    uncategorized: 1000
  });

  assert.deepEqual(await deleteCategory("groceries", {
    replacement_id: "home"
  }), {
    ok: true,
    transactions: 2,
    rules: 1
  });

  assert.equal(await categoryOf(db, "market-rule"), "home");
  assert.equal(await categoryOf(db, "market-manual"), "home");
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "market-manual")).get())?.category_source, "manual");
  assert.equal((await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, "rule-market")).get())?.category_id, "home");
  assert.equal((await db.select().from(schema.categories).where(eq(schema.categories.id, "groceries")).get()), undefined);
  assert.deepEqual(await spendingByCategory(), {
    home: 2000,
    leisure: 1000,
    uncategorized: 1000
  });
});

test("deleting a category can leave its transactions uncategorized, which deletes its rules and keeps manual assignments manual", async context => {
  const db = await managementDatabase(context);

  assert.deepEqual(await deleteCategory("leisure", {
    replacement_id: null
  }), {
    ok: true,
    transactions: 1,
    rules: 2
  });

  assert.equal(await categoryOf(db, "cinema-rule"), null);
  assert.deepEqual((await storedRules(db)).map(rule => rule.id), ["rule-market"]);
  assert.deepEqual(await spendingByCategory(), {
    groceries: 2000,
    uncategorized: 2000
  });

  // A later apply only uses the remaining rules and never touches the manual assignment.
  await deleteCategory("groceries", {
    replacement_id: null
  });
  await applyRulesToUncorrectedTransactions();
  assert.equal(await categoryOf(db, "market-manual"), null);
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.id, "market-manual")).get())?.category_source, "manual");
});

test("invalid category deletions change nothing", async context => {
  const db = await managementDatabase(context);
  const transactionsBefore = await storedTransactions(db);
  const rulesBefore = await storedRules(db);

  await assert.rejects(deleteCategory("groceries", {
    replacement_id: "groceries"
  }), ValidationError);
  await assert.rejects(deleteCategory("groceries", {
    replacement_id: "missing"
  }), ValidationError);
  await assert.rejects(deleteCategory("missing", {
    replacement_id: null
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
  await assert.rejects(deleteCategory("groceries", {}), z.ZodError);
  await assert.rejects(categoryUsage("missing"), (error: unknown) => error instanceof HttpError && error.status === 404);
  assert.deepEqual(await storedTransactions(db), transactionsBefore);
  assert.deepEqual(await storedRules(db), rulesBefore);
  assert.ok(await db.select().from(schema.categories).where(eq(schema.categories.id, "groceries")).get());
});

test("an edit preview of a disabled rule decides nothing, as applying the saved edit would", async context => {
  const db = await managementDatabase(context);
  const draft = {
    pattern: "CINEMA",
    mode: "keyword",
    priority: 1,
    rule_id: "rule-cinema"
  };

  assert.deepEqual(await previewRule(draft), {
    id: "rule-cinema",
    enabled: false,
    matched: 0,
    uncategorized: 0,
    manual: 0,
    manual_same_category: 0
  });

  // Applying after the saved edit agrees: the disabled rule leaves the cinema booking with its previous category.
  await db.update(schema.transactions).set({
    category_id: "groceries"
  }).where(eq(schema.transactions.id, "cinema-rule"));
  await applyRulesToUncorrectedTransactions();
  assert.equal(await categoryOf(db, "cinema-rule"), null);
});

test("a new rule is stored with its previewed ID, so it decides exactly the counted transactions", async context => {
  const db = await managementDatabase(context);
  const draft = {
    pattern: "CAFE",
    mode: "keyword",
    priority: 100
  };
  // The ID tie-break against the cafe rule at the same priority decides the outcome; try previews until one sorts first.
  let preview = await previewRule(draft);

  while (preview.id.localeCompare("rule-cafe") >= 0) {
    preview = await previewRule(draft);
  }

  assert.equal(preview.matched, 2);
  assert.equal(preview.uncategorized, 1);
  await createRule({
    ...draft,
    id: preview.id,
    name: "Cafe first",
    category_id: "home",
    apply_to_uncategorized: true
  });

  assert.ok((await storedRules(db)).some(rule => rule.id === preview.id));
  assert.equal(await categoryOf(db, "uncategorized-cafe"), "home");
  await assert.rejects(createRule({
    ...draft,
    id: preview.id,
    name: "Duplicate",
    category_id: "home"
  }), (error: unknown) => error instanceof HttpError && error.status === 409);
  await assert.rejects(createRule({
    ...draft,
    id: "not-a-uuid",
    name: "Invalid",
    category_id: "home"
  }), z.ZodError);
});

test("without a priority, a new rule goes to the end of the list and an edited rule keeps its position", async context => {
  const db = await managementDatabase(context);

  await reorderRules({
    ids: ["rule-cafe", "rule-market", "rule-cinema"]
  });
  await createRule({
    name: "Bakery",
    pattern: "BAKERY",
    mode: "keyword",
    category_id: "groceries"
  });
  await updateRuleDetails("rule-cafe", {
    name: "Cafe and bistro",
    pattern: "CAFE",
    mode: "keyword",
    category_id: "leisure"
  });

  const summaries = await listRuleSummaries();

  assert.deepEqual(summaries.map(rule => rule.name), ["Cafe and bistro", "Market", "Cinema", "Bakery"]);
  assert.equal(summaries[3].priority, 40);
  assert.equal((await storedRules(db)).length, 4);
});

test("appending after a rule at the highest priority renumbers the stored order atomically and places the new rule last", async context => {
  const db = await managementDatabase(context);

  // Priorities left by the earlier numeric editor: two rules already sit at the ceiling.
  await db.update(schema.categorizationRules).set({
    priority: 10000
  }).where(eq(schema.categorizationRules.id, "rule-cafe"));
  await db.update(schema.categorizationRules).set({
    priority: 10000
  }).where(eq(schema.categorizationRules.id, "rule-cinema"));
  const orderBefore = (await listRules()).map(rule => rule.id);
  // "0000…" sorts before every stored ID, so a shared ceiling priority would put it first among equals.
  const preview = await previewRule({
    pattern: "CAFE",
    mode: "keyword"
  });

  await createRule({
    id: "00000000-0000-4000-8000-000000000000",
    name: "Last",
    pattern: "CAFE",
    mode: "keyword",
    category_id: "home"
  });

  const rules = await listRules();

  assert.deepEqual(rules.map(rule => rule.id), [...orderBefore, "00000000-0000-4000-8000-000000000000"]);
  assert.deepEqual(rules.map(rule => rule.priority), [10, 20, 30, 40]);
  assert.equal(preview.matched, 0);
  // Earlier rules still decide what they decided before.
  assert.equal(categorize({
    counterparty: "Harbour Cafe",
    description: ""
  }, prepareRules(rules)), "leisure");
});

test("creating a rule, with or without a priority, is rejected once 1,000 rules exist", async context => {
  const db = await managementDatabase(context);
  const existing = (await storedRules(db)).length;
  const filler = Array.from({
    length: 1000 - existing
  }, (_, index) => ({
    id: `filler-${String(index).padStart(5, "0")}`,
    name: "Filler",
    pattern: `FILLER${index}`,
    mode: "keyword" as const,
    category_id: "groceries",
    priority: 1,
    enabled: 0
  }));

  for (let offset = 0; offset < filler.length; offset += 500) {
    await db.insert(schema.categorizationRules).values(filler.slice(offset, offset + 500));
  }

  await assert.rejects(createRule({
    name: "One too many",
    pattern: "EXTRA",
    mode: "keyword",
    category_id: "groceries"
  }), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "Ufer supports at most 1,000 rules. Delete a rule before creating another.");
  // The repository only reports the refusal; the service words it in the request's locale after the transaction rolled back.
  await assert.rejects(appendRule({
    id: "repository-extra",
    name: "Repository extra",
    pattern: "EXTRA",
    mode: "keyword",
    category_id: "groceries",
    enabled: true
  }), (error: unknown) => error instanceof RuleLimitReached && error.maximum === 1000);
  await assert.rejects(createRule({
    name: "One too many at a priority",
    pattern: "EXTRA",
    mode: "keyword",
    category_id: "groceries",
    priority: 5,
    apply_to_uncategorized: true
  }), (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.equal((await storedRules(db)).length, 1000);
});

test("deleting a category also moves hidden bookings, which stay out of the reports", async context => {
  const db = await managementDatabase(context);

  await db.update(schema.transactions).set({
    suppressed_at: "2026-01-20T00:00:00.000Z"
  }).where(eq(schema.transactions.id, "cinema-rule"));
  assert.deepEqual(await spendingByCategory(), {
    groceries: 2000,
    uncategorized: 1000
  });

  await deleteCategory("leisure", {
    replacement_id: "home"
  });

  assert.equal(await categoryOf(db, "cinema-rule"), "home");
  assert.deepEqual(await spendingByCategory(), {
    groceries: 2000,
    uncategorized: 1000
  });
});
