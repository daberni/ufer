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
import { averageAmount, categoryHistory } from "../src/features/insights/category-history";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { transactionListRequest } from "../src/features/transactions/server/transaction-list-request";
import { parseRange } from "../src/lib/period-range";
import { allMonthsPeriod, monthPeriod } from "../src/lib/period";
import { today } from "../src/lib/time";
import { categoryHistoryHref } from "../src/client/app-location";

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

test("a category's history follows the selected interval with the counted amount of each period", async context => {
  await seed(context);

  const columns = insightsColumns(await readInsights(range("2026-Q4"), "EUR", now));
  const history = categoryHistory(columns, "synthetic-food", "expense");

  assert.equal(history.length, 12);
  assert.deepEqual(history.slice(-3).map(column => [column.key, column.amount]), [
    ["2026-04-01", 30000],
    ["2026-07-01", 40000],
    ["2026-10-01", 25000]
  ]);
  assert.ok(history.slice(0, -3).every(column => column.amount === 0));
  // The shown columns average to whole minor units: (30000 + 40000 + 25000) / 3.
  assert.equal(averageAmount(history.slice(-3)), 31667);
  assert.equal(averageAmount(history.slice(-2)), 32500);
  assert.equal(averageAmount([]), 0);

  const uncategorized = categoryHistory(columns, "uncategorized", "expense");

  assert.equal(uncategorized.at(-1)?.amount, 12000);
  assert.ok(categoryHistory(columns, "synthetic-food", "income").every(column => column.amount === 0));
});

test("the history's transactions are the category's bookings in the selected range", async context => {
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

test("a breakdown over all months opens the yearly history up to this year instead of the current month", () => {
  const year = today().year;

  assert.equal(categoryHistoryHref({
    period: allMonthsPeriod,
    currency: "USD",
    category: "synthetic-food",
    type: "expense"
  }), `/insights?range=${year}&currency=USD&category=synthetic-food&type=expense`);
  assert.equal(categoryHistoryHref({
    period: monthPeriod(Temporal.PlainYearMonth.from("2026-07")),
    currency: "EUR",
    category: "uncategorized",
    type: "income"
  }), "/insights?range=2026-07&category=uncategorized&type=income");
});
