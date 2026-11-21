import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { Temporal } from "temporal-polyfill";
import { allMonthsPeriod, currentMonth, monthPeriod, parsePeriod, periodFromJson, periodToJson, serializePeriod, trendMonths, type Period } from "../src/lib/period";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { readCashFlow } from "../src/features/reports/server/cash-flow-query";
import { periodCondition } from "../src/features/transactions/server/period-condition";
import { readTransactionPage } from "../src/features/transactions/server/transaction-list-query";
import { derivedTransactionType } from "../src/features/transactions/transaction-types";

// Temporal values have no enumerable fields, so compare periods through their serialized form.
function serialized(period: Period | null) {
  return period ? serializePeriod(period) : null;
}

test("a period has one query representation that round-trips", () => {
  assert.equal(serialized(parsePeriod("all")), "all");
  assert.equal(serialized(parsePeriod("2026-01")), "2026-01");
  assert.equal(serialized(parsePeriod("2026-12")), "2026-12");
  assert.deepEqual(periodToJson(parsePeriod("2026-12")!), {
    kind: "month",
    month: "2026-12"
  });
  assert.equal(serialized(periodFromJson(periodToJson(allMonthsPeriod))), "all");

  for (const invalid of ["", "ALL", "2026-13", "2026-00", "2026-1", "2026-01-01"]) {
    assert.equal(parsePeriod(invalid), null, invalid);
  }
});

test("the current month follows Vienna time at the UTC month boundary", () => {
  assert.equal(currentMonth(Temporal.Instant.from("2026-10-31T23:30:00Z")).toString(), "2026-11");
  assert.equal(currentMonth(Temporal.Instant.from("2026-10-31T22:30:00Z")).toString(), "2026-10");
});

test("the trend window crosses year boundaries", () => {
  const march = Temporal.PlainYearMonth.from("2026-03");

  assert.deepEqual(trendMonths(monthPeriod(Temporal.PlainYearMonth.from("2026-02")), march).map(String), ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(trendMonths(allMonthsPeriod, march).map(String), ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
});

test("dashboard filters accept one period parameter and reject invalid periods", () => {
  assert.equal(serialized(dashboardFilters(new URLSearchParams()).period), currentMonth().toString());
  assert.equal(serialized(dashboardFilters(new URLSearchParams("period=all")).period), "all");
  assert.equal(serialized(dashboardFilters(new URLSearchParams("period=2026-02")).period), "2026-02");
  assert.throws(() => dashboardFilters(new URLSearchParams("period=2026-13")), {
    status: 400
  });
});

async function seededDatabase(context: TestContext) {
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
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  });
  await db.insert(schema.transactions).values([{
    id: "december-income",
    account_id: "checking",
    provider_reference: "synthetic-1",
    booking_date: "2025-12-15",
    amount_minor: 100000,
    currency: "EUR",
    type: "income",
    counterparty: "Example employer"
  }, {
    id: "january-start",
    account_id: "checking",
    provider_reference: "synthetic-2",
    booking_date: "2026-01-01",
    amount_minor: -30000,
    currency: "EUR",
    type: "expense",
    counterparty: "Example landlord"
  }, {
    id: "january-end",
    account_id: "checking",
    provider_reference: "synthetic-3",
    booking_date: "2026-01-31",
    amount_minor: -20000,
    currency: "EUR",
    type: "expense",
    counterparty: "Example supermarket"
  }, {
    id: "february-start",
    account_id: "checking",
    provider_reference: "synthetic-4",
    booking_date: "2026-02-01",
    amount_minor: -5000,
    currency: "EUR",
    type: "expense",
    counterparty: "Example pharmacy"
  }]);

  return db;
}

function spending(cashFlow: Awaited<ReturnType<typeof readCashFlow>>) {
  return cashFlow.expenseBreakdown.reduce((total, item) => total + item.amount, 0);
}

// The transaction list and the cash-flow report are separate requests for the same filters.
async function readPeriod(query: string) {
  const filters = dashboardFilters(new URLSearchParams(query));
  const [list, cashFlow] = await Promise.all([readTransactionPage(filters), readCashFlow(filters.period, filters.currency)]);

  return {
    list,
    cashFlow
  };
}

test("a month period limits transactions, cash flow and spending to the same calendar month", async context => {
  await seededDatabase(context);
  const {
    list,
    cashFlow
  } = await readPeriod("period=2026-01");

  assert.deepEqual(list.period, {
    kind: "month",
    month: "2026-01"
  });
  assert.deepEqual(cashFlow.period, list.period);
  assert.equal(list.transactionCount, 2);
  assert.deepEqual(list.transactions.map(item => item.id), ["january-end", "january-start"]);
  assert.equal(cashFlow.income, 0);
  assert.equal(cashFlow.expenses, 50000);
  assert.equal(spending(cashFlow), 50000);
  assert.deepEqual(cashFlow.trend.map(item => item.month), ["2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  assert.deepEqual(cashFlow.trend.slice(-2), [{
    month: "2025-12",
    income: 100000,
    expenses: 0,
    incomeBreakdown: [{
      categoryId: null,
      name: "Uncategorized",
      color: "#a2aaa5",
      icon: null,
      amount: 100000
    }],
    expenseBreakdown: []
  }, {
    month: "2026-01",
    income: 0,
    expenses: 50000,
    incomeBreakdown: [],
    expenseBreakdown: [{
      categoryId: null,
      name: "Uncategorized",
      color: "#a2aaa5",
      icon: null,
      amount: 50000
    }]
  }]);
});

test("the all-months period applies to cash flow and spending as well as the transaction list", async context => {
  await seededDatabase(context);
  const {
    list,
    cashFlow
  } = await readPeriod("period=all");

  assert.deepEqual(list.period, {
    kind: "all"
  });
  assert.deepEqual(cashFlow.period, list.period);
  assert.equal(list.transactionCount, 4);
  assert.equal(cashFlow.income, 100000);
  assert.equal(cashFlow.expenses, 55000);
  assert.equal(spending(cashFlow), 55000);
  assert.equal(cashFlow.trend.length, 12);
  assert.equal(cashFlow.trend.at(-1)?.month, currentMonth().toString());
});

test("a December period includes its last day and ends before the next year's first day", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values([{
    id: "november-end",
    account_id: "checking",
    provider_reference: "synthetic-5",
    booking_date: "2025-11-30",
    amount_minor: -700,
    currency: "EUR",
    type: "expense"
  }, {
    id: "december-end",
    account_id: "checking",
    provider_reference: "synthetic-6",
    booking_date: "2025-12-31",
    amount_minor: -900,
    currency: "EUR",
    type: "expense"
  }]);
  const {
    list,
    cashFlow
  } = await readPeriod("period=2025-12");

  assert.deepEqual(list.transactions.map(item => item.id), ["december-end", "december-income"]);
  assert.equal(cashFlow.income, 100000);
  assert.equal(cashFlow.expenses, 900);
});

test("a month period filters booking dates through the booking-date index", async context => {
  const db = await seededDatabase(context);
  const inPeriod = periodCondition(monthPeriod(Temporal.PlainYearMonth.from("2026-01")));
  const plan = await db.$client.execute({
    sql: `EXPLAIN QUERY PLAN SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE ${inPeriod.sql}`,
    args: inPeriod.args
  });

  assert.match(plan.rows.map(row => String(row.detail)).join("\n"), /USING (COVERING )?INDEX transactions_\w+ \(.*booking_date>\? AND booking_date<\?\)/);
});

async function seedCashFlowHistory(context: TestContext) {
  const db = await seededDatabase(context);
  const entries: [string, string, number, string | null][] = [
    ["2025-11-01", "EUR", 250000, "income"],
    ["2025-11-02", "EUR", 30000, "transfer"],
    ["2025-11-15", "EUR", 1200, null],
    ["2025-11-16", "USD", 5000, "income"],
    ["2025-11-03", "EUR", -4000, "groceries"],
    ["2025-11-20", "EUR", -90000, "home"],
    ["2025-11-21", "EUR", -50000, "transfer"],
    ["2025-12-02", "EUR", -2500, "groceries"],
    ["2025-12-09", "EUR", -1200, "transport"],
    ["2025-12-12", "EUR", -800, "leisure"],
    ["2025-12-18", "EUR", -3100, "fees"],
    ["2025-12-22", "EUR", -400, "health"],
    ["2025-12-23", "EUR", -650, "gifts"],
    ["2025-12-28", "EUR", -700, null],
    ["2025-12-29", "EUR", -20000, "transfer"],
    ["2025-12-30", "USD", -9900, "groceries"],
    ["2026-02-10", "EUR", 15000, "groceries"],
    ["2026-02-11", "EUR", -6000, "groceries"]
  ];

  await db.insert(schema.categories).values([{
    id: "health",
    name: "Health",
    color: "#5f8fb0"
  }, {
    id: "gifts",
    name: "Gifts",
    color: "#b46f9a"
  }]);
  await db.insert(schema.transactions).values(entries.map(([bookingDate, currency, amount, categoryId], index) => ({
    id: `history-${index}`,
    account_id: "checking",
    provider_reference: `synthetic-history-${index}`,
    booking_date: bookingDate,
    amount_minor: amount,
    currency,
    category_id: categoryId === "transfer" ? null : categoryId,
    type: derivedTransactionType(amount, categoryId === "transfer")
  })));
}

test("each trend month's breakdowns agree with that month's period totals and spending breakdown", async context => {
  await seedCashFlowHistory(context);
  const window = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-02")), "EUR");

  assert.deepEqual(window.trend.map(item => item.month), ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);

  for (const month of window.trend) {
    const period = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from(month.month)), "EUR");

    const monthIncome = month.incomeBreakdown.reduce((total, item) => total + item.amount, 0);

    assert.deepEqual(month.expenseBreakdown, period.expenseBreakdown, month.month);
    assert.deepEqual(month.incomeBreakdown, period.incomeBreakdown, month.month);
    assert.equal(month.expenses, period.expenses, month.month);
    assert.equal(spending(period), month.expenses, month.month);
    assert.equal(month.income, period.income, month.month);
    assert.equal(monthIncome, month.income, month.month);
  }
});

test("the month before the trend carries only its totals, for the chart's net continuation", async context => {
  await seedCashFlowHistory(context);
  const window = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-12")), "EUR");
  const before = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2025-12")), "EUR");

  assert.ok(before.expenses > 0);
  assert.deepEqual(window.leadIn, {
    month: "2025-12",
    income: before.income,
    expenses: before.expenses
  });
  assert.equal(window.trend.length, 12);
  assert.equal(window.trend[0].month, "2026-01");
});

test("a month's breakdowns leave out transfers and other currencies and keep uncategorized transactions", async context => {
  await seedCashFlowHistory(context);
  const window = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-02")), "EUR");
  const november = window.trend.find(item => item.month === "2025-11");
  const december = window.trend.find(item => item.month === "2025-12");
  const january = window.trend.find(item => item.month === "2026-01");

  assert.deepEqual(november?.incomeBreakdown.map(item => [item.categoryId, item.amount]), [["income", 250000], [null, 1200]]);
  assert.equal(november?.income, 251200);
  assert.deepEqual(november?.expenseBreakdown.map(item => [item.categoryId, item.amount]), [["home", 90000], ["groceries", 4000]]);
  assert.equal(november?.expenses, 94000);
  assert.deepEqual(december?.expenseBreakdown.map(item => [item.categoryId, item.amount]), [["fees", 3100], ["groceries", 2500], ["transport", 1200], ["leisure", 800], [null, 700], ["gifts", 650], ["health", 400]]);
  assert.equal(december?.expenseBreakdown.find(item => item.categoryId === null)?.name, "Uncategorized");
  assert.equal(december?.expenses, 9350);
  assert.deepEqual(january?.expenseBreakdown.map(item => [item.categoryId, item.amount]), [[null, 50000]]);
});

test("bookings of the same day are listed alphabetically by payee, with empty payees last", async context => {
  const db = await seededDatabase(context);

  await db.insert(schema.transactions).values([{
    id: "z-row",
    account_id: "checking",
    provider_reference: "same-day-1",
    booking_date: "2026-03-10",
    amount_minor: -100,
    currency: "EUR",
    type: "expense",
    counterparty: "",
    description: "Card fee",
    created_at: "2026-03-10T08:00:00.000Z"
  }, {
    id: "a-row",
    account_id: "checking",
    provider_reference: "same-day-2",
    booking_date: "2026-03-10",
    amount_minor: -200,
    currency: "EUR",
    type: "expense",
    counterparty: "zoo shop",
    created_at: "2026-03-10T09:00:00.000Z"
  }, {
    id: "m-row",
    account_id: "checking",
    provider_reference: "same-day-3",
    booking_date: "2026-03-10",
    amount_minor: -300,
    currency: "EUR",
    type: "expense",
    counterparty: "Bakery",
    created_at: "2026-03-10T07:00:00.000Z"
  }]);

  const page = await readTransactionPage(dashboardFilters(new URLSearchParams({
    period: "2026-03"
  })));

  assert.deepEqual(page.transactions.map(transaction => transaction.id), ["m-row", "a-row", "z-row"]);
});

test("breakdowns keep net-negative categories as signed rows, so they sum to their totals", async context => {
  const db = await seededDatabase(context);
  const entries: [string, number, string, "income" | "expense"][] = [
    ["salary", 10000, "income", "income"],
    // An income correction booked in another category nets that category negative.
    ["correction", -2000, "fees", "income"],
    ["groceries", -3000, "groceries", "expense"],
    // A refund exceeding the category's spending nets it negative.
    ["refund", 5000, "home", "expense"]
  ];

  await db.insert(schema.transactions).values(entries.map(([id, amount, categoryId, type]) => ({
    id: `signed-${id}`,
    account_id: "checking",
    provider_reference: `synthetic-signed-${id}`,
    booking_date: "2026-03-10",
    amount_minor: amount,
    currency: "EUR",
    category_id: categoryId,
    type
  })));
  const cashFlow = await readCashFlow(monthPeriod(Temporal.PlainYearMonth.from("2026-03")), "EUR");
  const sum = (items: {
    amount: number
  }[]) => items.reduce((total, item) => total + item.amount, 0);
  const march = cashFlow.trend.find(item => item.month === "2026-03")!;

  assert.equal(cashFlow.income, 8000);
  assert.equal(cashFlow.expenses, -2000);
  assert.deepEqual(cashFlow.incomeBreakdown.map(item => [item.categoryId, item.amount]), [["income", 10000], ["fees", -2000]]);
  assert.deepEqual(cashFlow.expenseBreakdown.map(item => [item.categoryId, item.amount]), [["groceries", 3000], ["home", -5000]]);
  assert.equal(sum(cashFlow.incomeBreakdown), cashFlow.income);
  assert.equal(sum(cashFlow.expenseBreakdown), cashFlow.expenses);
  assert.equal(sum(march.incomeBreakdown), march.income);
  assert.equal(sum(march.expenseBreakdown), march.expenses);
});
