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
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { createRule, previewRule } from "../src/features/categorization/server/categorization-service";

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

  return categorize(counterparty, description, rules) === "groceries";
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
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  }, {
    id: "elsewhere",
    environment: "PRODUCTION",
    name: "Synthetic account in another environment",
    institution: "Example institution",
    kind: "checking"
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
      counterparty: "Example Market",
      category_id: "transfer"
    },
    {
      id: "unrelated",
      counterparty: "Other payee"
    },
    {
      id: "other-environment",
      counterparty: "Example Market",
      account_id: "elsewhere"
    }
  ];

  await db.insert(schema.transactions).values(bookings.map((booking, index) => ({
    account_id: "checking",
    provider_reference: `synthetic-${index}`,
    booking_date: "2000-01-10",
    amount_minor: -1000,
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

test("a rule preview counts the transactions the new rule would decide, without writing", async context => {
  const db = await seedBookings(context);
  const before = await categories(db);

  assert.deepEqual(await previewRule({
    pattern: "example market",
    mode: "keyword",
    priority: "100"
  }), {
    matched: 3,
    uncategorized: 2
  });
  assert.deepEqual(await previewRule({
    pattern: "Example Market",
    mode: "keyword",
    priority: "5"
  }), {
    matched: 4,
    uncategorized: 3
  });
  assert.deepEqual(await previewRule({
    pattern: "No such payee",
    mode: "keyword",
    priority: "100"
  }), {
    matched: 0,
    uncategorized: 0
  });
  await assert.rejects(previewRule({
    pattern: "   ",
    mode: "keyword",
    priority: "100"
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
    categorized: 2
  });

  assert.deepEqual(await categories(db), {
    ...before,
    "uncategorized-payee": "groceries/rule",
    "uncategorized-description": "groceries/rule"
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
