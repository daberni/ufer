import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { readInsights } from "../src/features/insights/server/insights-query";
import { insightsColumns } from "../src/features/insights/insights-columns";
import { averageNet, filterInsights } from "../src/features/insights/category-filter";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { transactionListRequest } from "../src/features/transactions/server/transaction-list-request";
import { parseRange } from "../src/lib/period-range";
import { allMonthsPeriod, monthPeriod } from "../src/lib/period";
import { today } from "../src/lib/time";
import { categoryInsightsHref } from "../src/client/app-location";

const now = Temporal.Instant.from("2026-11-25T11:00:00Z");

function range(value: string) {
  const parsed = parseRange(value);

  assert.ok(parsed, value);

  return parsed;
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
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    kind: "checking",
    provider: "manual"
  });
  await db.insert(schema.categories).values([{
    id: "synthetic-food",
    name: "Synthetic food",
    color: "#4f8a5b"
  }, {
    id: "synthetic-home",
    name: "Synthetic home",
    color: "#7d6fa8"
  }]);

  let count = 0;
  const booking = (date: string, amount: number, type: "income" | "expense" | "transfer", category: string | null, hidden = false): typeof schema.transactions.$inferInsert => {
    count += 1;

    return {
      id: `booking-${count}`,
      account_id: "checking",
      provider_reference: `manual:${count}`,
      date,
      amount_minor: amount,
      currency: "EUR",
      counterparty: `Example ${count}`,
      type,
      category_id: category,
      suppressed_at: hidden ? "2026-11-01T00:00:00Z" : null
    };
  };

  await db.insert(schema.transactions).values([
    // Q2
    booking("2026-05-10", -30000, "expense", "synthetic-food"),
    // Q3: a refund reduces the category's spending; a categorized transfer and a hidden booking never count.
    booking("2026-07-10", -45000, "expense", "synthetic-food"),
    booking("2026-08-12", 5000, "expense", "synthetic-food"),
    booking("2026-08-20", -99000, "transfer", "synthetic-food"),
    booking("2026-09-01", -77000, "expense", "synthetic-food", true),
    // Q4: a split booking counts only its food part.
    booking("2026-10-03", -60000, "expense", null),
    booking("2026-11-02", -12000, "expense", null)
  ]);
  await db.insert(schema.transactionSplits).values([{
    id: "split-food",
    transaction_id: "booking-6",
    position: 0,
    amount_minor: -25000,
    category_id: "synthetic-food"
  }, {
    id: "split-home",
    transaction_id: "booking-6",
    position: 1,
    amount_minor: -35000,
    category_id: "synthetic-home"
  }]);
}

test("narrowing the insights to a category keeps the interval columns with only its counted amounts", async context => {
  await seed(context);

  const insights = filterInsights(await readInsights(range("2026-Q4"), "EUR", now), "synthetic-food");
  const columns = insightsColumns(insights);

  assert.equal(columns.length, 12);
  // Q3: the refund reduces spending; the categorized transfer and the hidden booking never count. Q4: only the split's food part.
  assert.deepEqual(columns.slice(-3).map(column => [column.key, column.income, column.expenses]), [
    ["2026-04-01", 0, 30000],
    ["2026-07-01", 0, 40000],
    ["2026-10-01", 0, 25000]
  ]);
  assert.ok(columns.slice(0, -3).every(column => column.expenses === 0 && column.income === 0));
  assert.deepEqual(insights.comparison.current.expenseBreakdown.map(row => [row.categoryId, row.amount]), [["synthetic-food", 25000]]);
  assert.deepEqual(insights.comparison.current.expensesByAccount, []);
  // The shown columns' net averages to whole minor units: -(30000 + 40000 + 25000) / 3.
  assert.equal(averageNet(columns.slice(-3)), -31667);
  assert.equal(averageNet(columns.slice(-2)), -32500);
  assert.equal(averageNet([]), 0);

  const uncategorized = insightsColumns(filterInsights(await readInsights(range("2026-Q4"), "EUR", now), "uncategorized"));

  assert.equal(uncategorized.at(-1)?.expenses, 12000);
});

test("the narrowed insights list the category's bookings in the selected range", async context => {
  await seed(context);

  const filters = transactionListRequest({
    period: "2026-11",
    range: "2026-Q3",
    currency: "EUR",
    category: "synthetic-food",
    type: "expense",
    page: 1
  });
  const page = await readTransactionPage(filters, null);

  // The refund and the hidden booking are listed; the transfer is not an expense and a booking outside the quarter is out of range.
  assert.deepEqual(page.transactions.map(transaction => transaction.date), ["2026-09-01", "2026-08-12", "2026-07-10"]);

  const quarter = await readTransactionPage(transactionListRequest({
    range: "2026-Q4",
    currency: "EUR",
    category: "synthetic-food",
    type: "expense",
    page: 1
  }), null);

  assert.deepEqual(quarter.transactions.map(transaction => transaction.id), ["booking-6"]);
  assert.throws(() => transactionListRequest({
    range: "2026-Q5",
    page: 1
  }));
});

test("a category row opens the insights narrowed to it, over the years up to this one for all months", () => {
  const year = today().year;

  assert.equal(categoryInsightsHref({
    period: allMonthsPeriod,
    currency: "USD",
    key: "synthetic-food"
  }), `/insights?range=${year}&currency=USD&category=synthetic-food`);
  assert.equal(categoryInsightsHref({
    period: monthPeriod(Temporal.PlainYearMonth.from("2026-07")),
    currency: "EUR",
    key: "uncategorized"
  }), "/insights?range=2026-07&category=uncategorized");
});
