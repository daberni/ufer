import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { splitTransaction, unsplitTransaction } from "../src/features/transactions/server/split-service";
import { transferOptions, updateTransactionCategory, updateTransactionDetails } from "../src/features/transactions/server/transaction-service";
import { upsertTransactions } from "../src/features/transactions/server/transaction-repository";
import { readAccountCashFlow, readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { pairTransfersInEnvironment } from "../src/features/transactions/server/transfer-repository";
import { replaceSplit } from "../src/features/transactions/server/split-repository";
import { listAccounts } from "../src/features/accounts/server/account-queries";
import { applyRulesToUncorrectedTransactions, categoryUsage, createRule, deleteCategory, previewRule } from "../src/features/categorization/server/categorization-service";
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

test("a new rule adopting manual assignments leaves split bookings alone, and category usage counts bookings split into it", async context => {
  await seed(context);
  await splitTransaction("market", marketSplit());

  const created = await previewRule({
    pattern: "Example Market",
    mode: "keyword",
    priority: 100,
    category_id: "groceries"
  });

  await createRule({
    id: created.id,
    name: "Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    adopt_manual: true
  });

  const row = await marketRow();

  assert.equal(row?.category_id, null);
  assert.equal(row?.category_source, "manual");
  assert.equal((await categoryUsage("leisure")).transactions, 1);
});

test("automatic transfer pairing leaves a split booking as it is", async context => {
  const db = await seed(context);

  await db.insert(schema.accounts).values({
    id: "savings",
    environment: "SANDBOX",
    name: "Synthetic savings",
    institution: "Example institution",
    kind: "savings",
    provider: "enablebanking"
  });
  await db.insert(schema.transactions).values({
    id: "savings-in",
    account_id: "savings",
    provider_reference: "bank:savings-in",
    booking_date: "2026-01-10",
    amount_minor: 10000,
    currency: "EUR",
    counterparty: "Own checking",
    type: "transfer"
  });
  await splitTransaction("market", marketSplit());
  await pairTransfersInEnvironment("SANDBOX");

  const row = await marketRow();

  assert.equal(row?.type, "expense");
  assert.equal(row?.counterpart, null);
  assert.equal(row?.split?.parts.length, 2);
});

test("a part beyond the supported amount is rejected, so the parts always add up exactly", async context => {
  const db = await seed(context);

  await db.insert(schema.transactions).values({
    id: "cent",
    account_id: "checking",
    provider_reference: "bank:cent",
    booking_date: "2026-01-20",
    amount_minor: 1,
    currency: "EUR",
    counterparty: "Example interest",
    type: "income"
  });

  // In floating point 9007199254740991 + 2 rounds to 9007199254740992, so unbounded parts could appear to add up to the booking.
  await assert.rejects(splitTransaction("cent", {
    parts: [{
      amount: "90071992547409.91",
      category_id: null,
      note: ""
    }, {
      amount: "0.02",
      category_id: null,
      note: ""
    }, {
      amount: "-90071992547409.91",
      category_id: null,
      note: ""
    }]
  }), error => error instanceof ValidationError && /exceeds the supported amount/.test(error.message));
  assert.equal((await db.select().from(schema.transactionSplits)).length, 0);
});

test("a sync that changes a split booking's currency removes the split and returns it to its rules", async context => {
  const db = await seed(context);

  await splitTransaction("market", marketSplit());
  await db.transaction(tx => upsertTransactions(tx, "checking", [{
    reference: "bank:market",
    date: "2026-01-10",
    amount: -10000,
    currency: "USD",
    counterparty: "Example Market",
    description: "",
    categoryId: "groceries",
    categoryRuleId: null
  }]));

  const [stored] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, "market"));

  assert.equal((await db.select().from(schema.transactionSplits)).length, 0);
  assert.equal(stored.currency, "USD");
  assert.equal(stored.category_id, "groceries");
  assert.equal(stored.category_source, "rule");
});

test("a split booking keeps its type through a sync and cannot become another booking's transfer counterpart", async context => {
  const db = await seed(context);

  await db.insert(schema.accounts).values({
    id: "savings",
    environment: "SANDBOX",
    name: "Synthetic savings",
    institution: "Example institution",
    kind: "savings",
    provider: "enablebanking"
  });
  await db.insert(schema.transactions).values({
    id: "savings-in",
    account_id: "savings",
    provider_reference: "bank:savings-in",
    booking_date: "2026-01-10",
    amount_minor: 10000,
    currency: "EUR",
    counterparty: "Example deposit",
    type: "income"
  });
  await splitTransaction("market", marketSplit());
  await db.transaction(tx => upsertTransactions(tx, "checking", [{
    reference: "bank:market",
    date: "2026-01-10",
    amount: -10000,
    currency: "EUR",
    counterparty: "Example Market",
    description: "",
    transfer: true,
    categoryId: null,
    categoryRuleId: null
  }]));

  assert.equal((await marketRow())?.type, "expense");

  const options = await transferOptions("savings-in");

  assert.deepEqual(options.candidates.map(candidate => candidate.id), []);
  await assert.rejects(updateTransactionDetails("savings-in", {
    type: "transfer",
    transfer: {
      counterpart_id: "market"
    }
  }), ValidationError);

  const row = await marketRow();

  assert.equal(row?.type, "expense");
  assert.equal(row?.counterpart, null);
});

test("a booking on an archived account can neither be split nor unsplit", async context => {
  const db = await seed(context);

  await splitTransaction("market", marketSplit());
  await db.update(schema.accounts).set({
    archived_at: "2026-09-30T00:00:00Z"
  }).where(eq(schema.accounts.id, "checking"));

  await assert.rejects(splitTransaction("market", marketSplit()), error => error instanceof HttpError && error.status === 409);
  await assert.rejects(unsplitTransaction("market"), error => error instanceof HttpError && error.status === 409);
  assert.equal((await db.select().from(schema.transactionSplits).where(eq(schema.transactionSplits.transaction_id, "market"))).length, 2);
});

test("deleting a category reports each booking whose parts it held once, as its usage does", async context => {
  const db = await seed(context);

  await splitTransaction("market", {
    parts: [{
      amount: "-60.00",
      category_id: "leisure",
      note: ""
    }, {
      amount: "-40.00",
      category_id: "leisure",
      note: ""
    }]
  });

  const usage = await categoryUsage("leisure");
  const deleted = await deleteCategory("leisure", {
    replacement_id: null
  });

  assert.equal(usage.transactions, 1);
  assert.equal(deleted.transactions, usage.transactions);
  assert.deepEqual((await db.select().from(schema.transactionSplits).where(eq(schema.transactionSplits.transaction_id, "market"))).map(part => part.category_id), [null, null]);
});

test("categorizing a split booking of another environment is not found rather than refused as split", async context => {
  await seed(context);
  await splitTransaction("market", marketSplit());
  process.env.ENABLE_BANKING_ENVIRONMENT = "PRODUCTION";

  await assert.rejects(updateTransactionCategory("market", {
    category_id: "groceries"
  }), error => error instanceof HttpError && error.status === 404);
});

test("a split whose category was deleted after the request's check is rejected as invalid and keeps the earlier parts", async context => {
  const db = await seed(context);

  await splitTransaction("market", marketSplit());

  // The service already checked the category; it is gone by the time the write transaction runs.
  await assert.rejects(replaceSplit("market", () => [{
    amount: -7000,
    categoryId: "deleted-meanwhile",
    note: ""
  }, {
    amount: -3000,
    categoryId: "leisure",
    note: ""
  }]), error => error instanceof ValidationError);
  assert.deepEqual((await db.select().from(schema.transactionSplits).where(eq(schema.transactionSplits.transaction_id, "market"))).map(part => part.category_id).sort(), ["groceries", "leisure"]);
});
