import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { categorize, prepareRules } from "../src/lib/rules";
import { ValidationError } from "../src/lib/errors";
import { proposeRulePattern, proposedPatternLength } from "../src/features/categorization/rule-pattern";
import { listRuleSummaries } from "../src/features/categorization/server/categorization-queries";
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { applyRulesToUncorrectedTransactions, createRule, previewRule } from "../src/features/categorization/server/categorization-service";

function matchesOwnTransaction(pattern: string, counterparty: string, description: string) {
  const rules = prepareRules([{
    id: "proposed",
    name: "Proposed",
    pattern,
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    enabled: 1
  }]);

  return categorize({
    counterparty,
    description
  }, rules) === "groceries";
}

test("a proposed pattern uses the payee or, without one, the distinctive words of the description", () => {
  const bookings: [string, string, string][] = [
    ["Example Market", "POS 4711 OTHER TEXT", "Example Market"],
    ["  Example   Market  ", "", "Example   Market"],
    ["", "POS 4711 EXAMPLE BAKERY VIENNA 12.03. 14:22", "EXAMPLE BAKERY VIENNA"],
    ["", "Card payment 0042 Example Bakery, Main Street 5", "Example Bakery, Main Street"],
    ["", "Ref 12 (Example Market) 34", "Example Market"],
    ["", "4711 0815", "4711 0815"],
    ["", "", ""]
  ];

  for (const [counterparty, description, expected] of bookings) {
    assert.equal(proposeRulePattern(counterparty, description), expected);

    if (expected) {
      assert.ok(matchesOwnTransaction(expected, counterparty, description), expected);
    }
  }
});

test("a long proposal is shortened at a word boundary and still matches its transaction", () => {
  const payee = "Example Association for Synthetic Testing of Very Long Payee Names and More";
  const proposal = proposeRulePattern(payee, "");

  assert.ok(proposal.length <= proposedPatternLength);
  assert.ok(payee.startsWith(proposal));
  assert.match(payee.slice(proposal.length), /^\s/);
  assert.ok(matchesOwnTransaction(proposal, payee, ""));
});

async function seedBookings(context: TestContext) {
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
    kind: "checking"
  }, {
    id: "elsewhere",
    name: "Synthetic archived account",
    kind: "checking",
    archived_at: "2000-01-01T00:00:00.000Z"
  }]);

  const bookings: {
    id: string;
    counterparty: string;
    description?: string;
    category_id?: string;
    category_source?: "rule" | "manual";
    account_id?: string;
  }[] = [
    // The transaction the category was just chosen for.
    {
      id: "assigned",
      counterparty: "Example Market",
      category_id: "groceries",
      category_source: "manual"
    },
    {
      id: "uncategorized-payee",
      counterparty: "Example Market"
    },
    {
      id: "uncategorized-description",
      counterparty: "",
      description: "POS 4711 EXAMPLE MARKET VIENNA"
    },
    {
      id: "categorized-by-rule",
      counterparty: "Example Market",
      category_id: "leisure"
    },
    {
      id: "corrected",
      counterparty: "Example Market",
      category_id: "home",
      category_source: "manual"
    },
    // An existing rule with a lower priority number decides this one, although it was never applied.
    {
      id: "decided-by-express-rule",
      counterparty: "Example Market Express"
    },
    {
      id: "transfer",
      counterparty: "Example Market"
    },
    {
      id: "unrelated",
      counterparty: "Other payee"
    },
    {
      id: "archived-account",
      counterparty: "Example Market",
      account_id: "elsewhere"
    }
  ];

  await db.insert(schema.transactions).values(bookings.map((booking, index) => ({
    account_id: "checking",
    provider_reference: `synthetic-${index}`,
    booking_date: "2000-01-10",
    amount_minor: -1000,
    type: booking.id === "transfer" ? "transfer" as const : "expense" as const,
    currency: "EUR",
    ...booking
  })));
  await insertRule({
    id: "express-rule",
    name: "Express",
    pattern: "Express",
    mode: "keyword",
    category_id: "transport",
    priority: 10,
    enabled: true
  });

  return db;
}

async function categories(db: Database) {
  const rows = await db.select({
    id: schema.transactions.id,
    category_id: schema.transactions.category_id,
    category_source: schema.transactions.category_source
  }).from(schema.transactions);

  return Object.fromEntries(rows.map(row => [row.id, `${row.category_id ?? "none"}/${row.category_source}`]));
}

async function previewCounts(payload: unknown) {
  const {
    id,
    enabled,
    transactions: _transactions,
    ...counts
  } = await previewRule(payload);

  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(enabled, true);

  return counts;
}

test("a rule preview counts the transactions the new rule would decide, without writing", async context => {
  const db = await seedBookings(context);
  const before = await categories(db);

  assert.deepEqual(await previewCounts({
    pattern: "example market",
    mode: "keyword",
    priority: 100
  }), {
    matched: 5,
    uncategorized: 4,
    matched_same_category: 0,
    manual: 2,
    manual_same_category: 0
  });
  assert.deepEqual(await previewCounts({
    pattern: "Example Market",
    mode: "keyword",
    priority: 5
  }), {
    matched: 6,
    uncategorized: 5,
    matched_same_category: 0,
    manual: 2,
    manual_same_category: 0
  });
  assert.deepEqual(await previewCounts({
    pattern: "No such payee",
    mode: "keyword",
    priority: 100
  }), {
    matched: 0,
    uncategorized: 0,
    matched_same_category: 0,
    manual: 0,
    manual_same_category: 0
  });
  await assert.rejects(previewRule({
    pattern: "   ",
    mode: "keyword",
    priority: 100
  }), ValidationError);

  assert.deepEqual(await categories(db), before);
  assert.equal((await db.select().from(schema.categorizationRules)).length, 1);
});

test("a rule applied to existing transactions categorizes only the uncategorized ones it decides", async context => {
  const db = await seedBookings(context);
  const before = await categories(db);

  assert.deepEqual(await createRule({
    name: "Example Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    apply_to_uncategorized: true
  }), {
    ok: true,
    categorized: 4
  });

  // Archiving freezes balances, not categories, so a booking on an archived account is categorized too.
  assert.deepEqual(await categories(db), {
    ...before,
    "uncategorized-payee": "groceries/rule",
    "uncategorized-description": "groceries/rule",
    "transfer": "groceries/rule",
    "archived-account": "groceries/rule"
  });

  const stored = await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.name, "Example Market")).get();

  assert.equal(stored?.priority, 100);
  assert.equal(stored?.enabled, 1);
});

test("a rule created without applying it leaves existing transactions unchanged", async context => {
  const db = await seedBookings(context);
  const before = await categories(db);

  assert.deepEqual(await createRule({
    name: "Example Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100
  }), {
    ok: true,
    categorized: 0
  });
  assert.deepEqual(await categories(db), before);
  assert.equal((await db.select().from(schema.categorizationRules)).length, 2);
});

test("preview, creation and later matching use the same live ID tie-break", async context => {
  const db = await seedBookings(context);

  await insertRule({
    id: "zzz-older-rule",
    name: "Market",
    pattern: "Market",
    mode: "keyword",
    category_id: "leisure",
    priority: 100,
    enabled: true
  });
  const preview = await previewRule({
    pattern: "Example Market",
    mode: "keyword",
    priority: 100
  });

  assert.match(preview.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual({
    matched: preview.matched,
    uncategorized: preview.uncategorized
  }, {
    matched: 5,
    uncategorized: 4
  });
  assert.deepEqual(await createRule({
    id: preview.id,
    name: "Example Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    apply_to_uncategorized: true
  }), {
    ok: true,
    categorized: preview.uncategorized
  });
  assert.ok(await db.select().from(schema.categorizationRules).where(eq(schema.categorizationRules.id, preview.id)).get());

  await applyRulesToUncorrectedTransactions();
  const decided = await categories(db);

  assert.equal(decided["uncategorized-payee"], "groceries/rule");
  assert.equal(decided["uncategorized-description"], "groceries/rule");
  assert.equal(decided["categorized-by-rule"], "groceries/rule");
});

test("rule creation does not categorize a transaction whose payee changed before its write begins", async context => {
  const db = await seedBookings(context);
  let editPending = true;

  const editBeforeWrite = async () => {
    if (!editPending) {
      return;
    }

    editPending = false;
    await db.update(schema.transactions).set({
      counterparty: "Salary"
    }).where(eq(schema.transactions.id, "uncategorized-payee"));
  };
  const batch = db.batch.bind(db);
  const transaction = db.transaction.bind(db);

  context.mock.method(db, "batch", async (...args: Parameters<Database["batch"]>) => {
    await editBeforeWrite();

    return batch(...args);
  });
  context.mock.method(db, "transaction", async (...args: Parameters<Database["transaction"]>) => {
    await editBeforeWrite();

    return transaction(...args);
  });

  const result = await createRule({
    name: "Market",
    pattern: "Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    apply_to_uncategorized: true
  });

  assert.equal((await categories(db))["uncategorized-payee"], "none/rule");
  assert.equal(result.categorized, 3);
});

test("applying a newly created higher-priority rule preserves already categorized transactions", async context => {
  const db = await seedBookings(context);
  const input = {
    name: "Market",
    pattern: "Market",
    mode: "keyword" as const,
    category_id: "groceries",
    priority: 100,
    apply_to_uncategorized: true
  };

  await createRule(input);
  const before = await categories(db);
  const result = await createRule({
    ...input,
    category_id: "home",
    priority: 1
  });

  assert.equal((await categories(db))["uncategorized-payee"], before["uncategorized-payee"]);
  assert.equal((await categories(db))["categorized-by-rule"], before["categorized-by-rule"]);
  assert.equal(result.categorized, 1);
});

test("failed assignment selection rolls back the new rule without changing transactions", async context => {
  const db = await seedBookings(context);
  const before = await categories(db);
  const failure = new Error("Matching failed");

  await assert.rejects(insertRule({
    id: "failed-rule",
    name: "Market",
    pattern: "Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    enabled: true
  }, {
    uncategorized: () => {
      throw failure;
    }
  }), failure);

  assert.equal((await db.select().from(schema.categorizationRules)).length, 1);
  assert.deepEqual(await categories(db), before);
});


test("equal-priority rules retain the live ID tie-break regardless of insertion or storage order", async context => {
  const db = await seedBookings(context);

  for (const rule of [{
    id: "zzz-older",
    category_id: "groceries"
  }, {
    id: "aaa-newer",
    category_id: "leisure"
  }]) {
    await insertRule({
      ...rule,
      name: "Market",
      pattern: "Market",
      mode: "keyword",
      priority: 100,
      enabled: true
    });
  }

  await applyRulesToUncorrectedTransactions();
  assert.equal((await categories(db))["uncategorized-payee"], "leisure/rule");
  assert.deepEqual((await listRuleSummaries()).filter(rule => rule.priority === 100).map(rule => rule.id), ["aaa-newer", "zzz-older"]);

  await db.$client.execute("UPDATE categorization_rules SET rowid=1000 WHERE id='aaa-newer'");
  await db.$client.execute("VACUUM");
  await applyRulesToUncorrectedTransactions();
  assert.equal((await categories(db))["uncategorized-payee"], "leisure/rule");
});

test("a preview does not count equal-priority matches won by a lower existing rule ID", async context => {
  await seedBookings(context);
  await insertRule({
    id: "00000000-0000-0000-0000-000000000000",
    name: "Market",
    pattern: "Market",
    mode: "keyword",
    category_id: "leisure",
    priority: 100,
    enabled: true
  });
  const preview = await previewRule({
    pattern: "Market",
    mode: "keyword",
    priority: 100
  });

  assert.equal(preview.matched, 0);
  assert.equal(preview.uncategorized, 0);
  assert.deepEqual(await createRule({
    id: preview.id,
    name: "Market",
    pattern: "Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    apply_to_uncategorized: true
  }), {
    ok: true,
    categorized: 0
  });
});
