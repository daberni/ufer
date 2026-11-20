import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { splitTransaction, unsplitTransaction } from "../src/features/transactions/server/split-service";
import { updateTransactionCategory, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { upsertTransactions } from "../src/features/transactions/server/transaction-repository";
import { readAccountCashFlow, readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { applyRulesToUncorrectedTransactions } from "../src/features/categorization/server/categorization-service";
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { HttpError, ValidationError } from "../src/lib/errors";
import { monthPeriod } from "../src/lib/period";

const january = monthPeriod(Temporal.PlainYearMonth.from("2026-01"));

async function seed(context: TestContext) {
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
    kind: "checking",
    provider: "enablebanking",
    balance_minor: 100000
  }, {
    id: "yen",
    environment: "SANDBOX",
    name: "Synthetic yen account",
    institution: "Example institution",
    kind: "checking",
    currency: "JPY",
    provider: "enablebanking"
  }]);
  await db.insert(schema.transactions).values([{
    id: "market",
    account_id: "checking",
    provider_reference: "bank:market",
    booking_date: "2026-01-10",
    amount_minor: -10000,
    currency: "EUR",
    counterparty: "Example Market",
    category_id: "groceries",
    category_source: "rule",
    type: "expense"
  }, {
    id: "salary",
    account_id: "checking",
    provider_reference: "bank:salary",
    booking_date: "2026-01-01",
    amount_minor: 50000,
    currency: "EUR",
    counterparty: "Example Employer",
    type: "income"
  }, {
    id: "yen-purchase",
    account_id: "yen",
    provider_reference: "bank:yen",
    booking_date: "2026-01-12",
    amount_minor: -1000,
    currency: "JPY",
    counterparty: "Example Shop",
    type: "expense"
  }, {
    id: "transfer",
    account_id: "checking",
    provider_reference: "bank:transfer",
    booking_date: "2026-01-15",
    amount_minor: -2000,
    currency: "EUR",
    counterparty: "Own savings",
    type: "transfer"
  }]);

  return db;
}

function marketSplit() {
  return {
    parts: [{
      amount: "-70.00",
      category_id: "groceries",
      note: ""
    }, {
      amount: "-30.00",
      category_id: "leisure",
      note: "Synthetic gift"
    }]
  };
}

async function marketRow() {
  const page = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-01")));

  return page.transactions.find(row => row.id === "market");
}

test("a split is rejected unless at least two non-zero parts add up exactly to the booking in its currency", async context => {
  const db = await seed(context);
  const cases: [string, unknown, RegExp][] = [
    ["market", {
      parts: [{
        amount: "-100.00",
        category_id: "groceries",
        note: ""
      }]
    }, /at least two parts/],
    ["market", {
      parts: [{
        amount: "-70.00",
        category_id: "groceries",
        note: ""
      }, {
        amount: "-29.99",
        category_id: "leisure",
        note: ""
      }]
    }, /add up to -€99\.99 instead of -€100\.00/],
    ["market", {
      parts: [{
        amount: "-100.00",
        category_id: "groceries",
        note: ""
      }, {
        amount: "0",
        category_id: "leisure",
        note: ""
      }]
    }, /Every part needs an amount/],
    ["yen-purchase", {
      parts: [{
        amount: "-500.5",
        category_id: "groceries",
        note: ""
      }, {
        amount: "-499.5",
        category_id: "leisure",
        note: ""
      }]
    }, /too many decimal places/],
    ["market", {
      parts: [{
        amount: "-50.00",
        category_id: "unknown",
        note: ""
      }, {
        amount: "-50.00",
        category_id: "leisure",
        note: ""
      }]
    }, /Category does not exist/],
    ["transfer", {
      parts: [{
        amount: "-10.00",
        category_id: "groceries",
        note: ""
      }, {
        amount: "-10.00",
        category_id: "leisure",
        note: ""
      }]
    }, /Only income and expenses/]
  ];

  for (const [id, payload, message] of cases) {
    await assert.rejects(splitTransaction(id, payload), error => error instanceof ValidationError && message.test(error.message));
  }

  assert.equal((await db.select().from(schema.transactionSplits)).length, 0);
  await assert.rejects(splitTransaction("missing", marketSplit()), error => error instanceof HttpError && error.status === 404);

  // A part going the other way, such as a refunded item, is allowed as long as the sum matches; the yen account takes whole units.
  await splitTransaction("market", {
    parts: [{
      amount: "-110.00",
      category_id: "groceries",
      note: ""
    }, {
      amount: "10.00",
      category_id: "leisure",
      note: ""
    }]
  });
  await splitTransaction("yen-purchase", {
    parts: [{
      amount: "-600",
      category_id: "groceries",
      note: ""
    }, {
      amount: "-400",
      category_id: null,
      note: ""
    }]
  });
});

test("reports count the parts of a split booking exactly once while balances and account flows keep the booking", async context => {
  await seed(context);

  const balancesBefore = await listAccounts();
  const accountFlowBefore = await readAccountCashFlow("checking", january);

  await splitTransaction("market", marketSplit());

  const cashFlow = await readCashFlow(january, "EUR");
  const expenses = Object.fromEntries(cashFlow.expenseBreakdown.map(row => [String(row.categoryId), row.amount]));
  const trendMonth = cashFlow.trend.find(month => month.month === "2026-01");

  assert.equal(cashFlow.expenses, 10000);
  assert.equal(cashFlow.income, 50000);
  assert.deepEqual(expenses, {
    groceries: 7000,
    leisure: 3000
  });
  assert.equal(trendMonth?.expenses, 10000);
  assert.deepEqual(trendMonth?.expenseBreakdown.map(row => [row.categoryId, row.amount]), [["groceries", 7000], ["leisure", 3000]]);
  assert.deepEqual(await listAccounts(), balancesBefore);
  assert.deepEqual(await readAccountCashFlow("checking", january), accountFlowBefore);

  const row = await marketRow();

  assert.deepEqual(row?.split?.parts.map(part => [part.amount_minor, part.category_id, part.note]), [[-7000, "groceries", ""], [-3000, "leisure", "Synthetic gift"]]);
  assert.equal(row?.split?.balanced, true);
  assert.equal(row?.category_id, null);

  const leisure = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-01&category=leisure")));

  assert.deepEqual(leisure.transactions.map(item => item.id), ["market"]);
});

test("rules leave a split booking alone and removing the split returns it to automatic categorization", async context => {
  await seed(context);
  await insertRule({
    id: "market-rule",
    name: "Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "leisure",
    priority: 1,
    enabled: true
  });
  await splitTransaction("market", marketSplit());
  await applyRulesToUncorrectedTransactions();

  const split = await marketRow();

  assert.equal(split?.category_id, null);
  assert.deepEqual(split?.split?.parts.map(part => part.category_id), ["groceries", "leisure"]);
  await assert.rejects(updateTransactionCategory("market", {
    category_id: "groceries"
  }), error => error instanceof HttpError && error.status === 409);
  await assert.rejects(updateTransactionDetails("market", {
    type: "transfer"
  }), /Remove the split/);

  await unsplitTransaction("market");

  const restored = await marketRow();

  assert.equal(restored?.split, null);
  assert.equal(restored?.category_id, "leisure");
  assert.equal(restored?.category_source, "rule");
});

test("a sync that changes a split booking's amount keeps the split, flags it and counts the difference as uncategorized", async context => {
  const db = await seed(context);

  await splitTransaction("market", marketSplit());
  await db.transaction(tx => upsertTransactions(tx, "checking", [{
    reference: "bank:market",
    date: "2026-01-10",
    amount: -12000,
    currency: "EUR",
    counterparty: "Example Market",
    description: "",
    categoryId: "groceries",
    categoryRuleId: null
  }]));

  const row = await marketRow();
  const cashFlow = await readCashFlow(january, "EUR");
  const expenses = Object.fromEntries(cashFlow.expenseBreakdown.map(item => [String(item.categoryId), item.amount]));
  const uncategorized = await readTransactionPage(dashboardFilters(new URLSearchParams("period=2026-01&category=uncategorized")));

  assert.equal(row?.amount_minor, -12000);
  assert.equal(row?.split?.balanced, false);
  assert.equal(row?.category_id, null);
  assert.equal(cashFlow.expenses, 12000);
  assert.deepEqual(expenses, {
    groceries: 7000,
    leisure: 3000,
    null: 2000
  });
  assert.ok(uncategorized.transactions.some(item => item.id === "market"));

  // Correcting the split balances it again.
  await splitTransaction("market", {
    parts: [{
      amount: "-90.00",
      category_id: "groceries",
      note: ""
    }, {
      amount: "-30.00",
      category_id: "leisure",
      note: ""
    }]
  });
  assert.equal((await marketRow())?.split?.balanced, true);
});
