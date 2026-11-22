import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { readAccountCashFlow, readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { monthPeriod } from "../src/lib/period";

const january = monthPeriod(Temporal.PlainYearMonth.from("2026-01"));

function booking(id: string, accountId: string, amount: number, type: "income" | "expense" | "transfer" | "opening_balance", extra: Partial<typeof schema.transactions.$inferInsert> = {}): typeof schema.transactions.$inferInsert {
  return {
    id,
    account_id: accountId,
    provider_reference: `bank:${id}`,
    date: "2026-01-10",
    amount_minor: amount,
    currency: "EUR",
    counterparty: `Example ${id}`,
    type,
    ...extra
  };
}

async function seed(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;

  context.after(() => {
    globals.budgetDb = previousDatabase;
    client.close();
  });

  await initializeDatabase(client);

  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  await db.insert(schema.accounts).values([{
    id: "checking",
    name: "Synthetic checking",
    kind: "checking",
    provider: "manual"
  }, {
    id: "savings",
    name: "Synthetic savings",
    kind: "savings",
    provider: "manual"
  }]);
  await db.insert(schema.transactions).values([
    booking("salary", "checking", 50000, "income"),
    // A negative booking corrected to income reduces income.
    booking("income-correction", "checking", -500, "income", {
      type_source: "manual"
    }),
    booking("market", "checking", -10000, "expense", {
      category_id: "groceries"
    }),
    // A refund is a positive expense and reduces spending.
    booking("refund", "checking", 1500, "expense", {
      type_source: "manual"
    }),
    booking("hidden", "checking", -9999, "expense", {
      suppressed_at: "2026-01-11T00:00:00Z"
    }),
    booking("transfer-out", "checking", -2000, "transfer"),
    booking("transfer-in", "checking", 3000, "transfer"),
    booking("opening", "checking", 70000, "opening_balance"),
    booking("savings-fee", "savings", -400, "expense")
  ]);
  // The parts add up to less than the booking, so the difference counts as an uncategorized line.
  await db.insert(schema.transactionSplits).values([{
    id: "market-1",
    transaction_id: "market",
    position: 0,
    amount_minor: -7000,
    category_id: "groceries"
  }, {
    id: "market-2",
    transaction_id: "market",
    position: 1,
    amount_minor: -2000,
    category_id: null
  }]);
}

test("account and overview cash flow count the same lines for splits, hidden bookings, transfers, refunds and type corrections", async context => {
  await seed(context);

  const checking = await readAccountCashFlow("checking", january);
  const savings = await readAccountCashFlow("savings", january);
  const overview = await readCashFlow(january, "EUR");
  const sum = (rows: {
    amount: number
  }[]) => rows.reduce((total, row) => total + row.amount, 0);

  assert.deepEqual({
    income: checking.income,
    expenses: checking.expenses,
    transfersIn: checking.transfersIn,
    transfersOut: checking.transfersOut
  }, {
    income: 49500,
    expenses: 8500,
    transfersIn: 3000,
    transfersOut: 2000
  });
  assert.equal(overview.income, checking.income + savings.income);
  assert.equal(overview.expenses, checking.expenses + savings.expenses);
  assert.equal(sum(overview.incomeBreakdown), overview.income);
  assert.equal(sum(overview.expenseBreakdown), overview.expenses);

  const january2026 = overview.trend.find(month => month.month === "2026-01");

  assert.equal(january2026?.income, overview.income);
  assert.equal(january2026?.expenses, overview.expenses);
});
