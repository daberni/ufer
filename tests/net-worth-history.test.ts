import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { allMonthsPeriod, monthPeriod } from "../src/lib/period";
import { projectNetWorthHistory, type AccountBalances } from "../src/features/accounts/net-worth-history";
import { readNetWorthHistory } from "../src/features/accounts/server/account-queries";
import { plotSeries } from "../src/features/accounts/balance-chart";

const today = Temporal.PlainDate.from("2026-11-17");

const month = (value: string) => monthPeriod(Temporal.PlainYearMonth.from(value));

const accounts: AccountBalances[] = [{
  kind: "checking",
  balances: [{
    date: "2026-08-31",
    amount_minor: 100000,
    source: "sync"
  }, {
    date: "2026-09-15",
    amount_minor: 120000,
    source: "sync"
  }, {
    date: "2026-11-10",
    amount_minor: 90000,
    source: "sync"
  }]
}, {
  kind: "property",
  balances: [{
    date: "2026-06-30",
    amount_minor: 30000000,
    source: "manual"
  }]
}, {
  kind: "loan",
  balances: [{
    date: "2026-09-30",
    amount_minor: -20000000,
    source: "csv"
  }]
}, {
  kind: "savings",
  balances: []
}];

test("net worth carries each account's latest balance forward to the month's end, counts the gaps and never interpolates", () => {
  const points = projectNetWorthHistory(accounts, month("2026-11"), today);

  // The year up to November starts with June, the first month with a balance.
  assert.deepEqual(points.map(point => [point.month, point.date]), [
    ["2026-06", "2026-06-30"],
    ["2026-07", "2026-07-31"],
    ["2026-08", "2026-08-31"],
    ["2026-09", "2026-09-30"],
    ["2026-10", "2026-10-31"],
    ["2026-11", "2026-11-17"]
  ]);
  assert.deepEqual(points[0], {
    month: "2026-06",
    date: "2026-06-30",
    netWorth: 30000000,
    liquidity: 0,
    investments: 0,
    property: 30000000,
    liabilities: 0,
    synced: 0,
    manual: 1,
    imported: 0,
    carried: 0,
    unvalued: 3
  });
  assert.deepEqual(points[3], {
    month: "2026-09",
    date: "2026-09-30",
    netWorth: 10120000,
    liquidity: 120000,
    investments: 0,
    property: 30000000,
    liabilities: -20000000,
    synced: 1,
    manual: 1,
    imported: 1,
    carried: 1,
    unvalued: 1
  });

  // October has no new balance: September's values are carried, not blended with November's.
  assert.equal(points[4].netWorth, points[3].netWorth);
  assert.equal(points[4].carried, 3);
  assert.deepEqual([points[5].netWorth, points[5].liquidity, points[5].carried], [10090000, 90000, 2]);
});

test("the shown months follow the selected period and never pass the current month", () => {
  const months = (period: Parameters<typeof projectNetWorthHistory>[1]) => projectNetWorthHistory(accounts, period, today).map(point => point.month);

  assert.deepEqual(months(month("2026-07")), ["2026-06", "2026-07"]);
  assert.deepEqual(months(month("2026-05")), []);
  assert.deepEqual(months(month("2027-02")), months(month("2026-11")));
  assert.deepEqual(months(allMonthsPeriod), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);

  const longHistory: AccountBalances[] = [{
    kind: "savings",
    balances: [{
      date: "2024-03-01",
      amount_minor: 100,
      source: "manual"
    }]
  }];

  assert.deepEqual(projectNetWorthHistory(longHistory, month("2026-11"), today).map(point => point.month)[0], "2025-12");
  assert.equal(projectNetWorthHistory(longHistory, allMonthsPeriod, today).length, 33);
  assert.deepEqual(projectNetWorthHistory([], allMonthsPeriod, today), []);
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

  const account = (id: string, kind: "checking" | "investment" | "loan", currency: string, environment = "SANDBOX") => ({
    id,
    environment,
    name: `Synthetic ${id}`,
    institution: "Example institution",
    kind,
    currency
  });

  await db.insert(schema.accounts).values([
    account("checking", "checking", "EUR"),
    account("broker", "investment", "EUR"),
    account("unvalued", "checking", "EUR"),
    account("dollars", "checking", "USD"),
    account("production", "checking", "EUR", "PRODUCTION")
  ]);

  const snapshot = (accountId: string, date: string, amount: number, source: "sync" | "manual" | "csv") => ({
    id: `${accountId}-${date}`,
    account_id: accountId,
    observed_at: date,
    amount_minor: amount,
    source
  });

  await db.insert(schema.balanceSnapshots).values([
    snapshot("checking", "2026-01-20", 50000, "sync"),
    snapshot("checking", "2026-02-27", 65000, "sync"),
    snapshot("broker", "2025-12-31", 1000000, "manual"),
    snapshot("dollars", "2026-01-31", 777700, "sync"),
    snapshot("production", "2026-01-31", 990000, "sync")
  ]);

  return db;
}

test("the net worth history reads only the current environment's accounts in the selected currency", async context => {
  await seededDatabase(context);

  const history = await readNetWorthHistory(month("2026-02"), "EUR");

  assert.deepEqual(history.period, {
    kind: "month",
    month: "2026-02"
  });
  assert.equal(history.currency, "EUR");
  assert.deepEqual(history.points.map(point => [point.month, point.netWorth, point.liquidity, point.investments, point.carried, point.unvalued]), [
    ["2025-12", 1000000, 0, 1000000, 0, 2],
    ["2026-01", 1050000, 50000, 1000000, 1, 1],
    ["2026-02", 1065000, 65000, 1000000, 1, 1]
  ]);

  const dollars = await readNetWorthHistory(month("2026-02"), "USD");

  assert.deepEqual(dollars.points.map(point => [point.month, point.netWorth]), [
    ["2026-01", 777700],
    ["2026-02", 777700]
  ]);
  assert.deepEqual((await readNetWorthHistory(month("2026-02"), "CHF")).points, []);
});

test("series share one scale, and zero is marked only when amounts lie on both sides of it", () => {
  const chart = plotSeries([[{
    date: "2026-01-31",
    amount_minor: 1000
  }, {
    date: "2026-02-28",
    amount_minor: 3000
  }], [{
    date: "2026-01-31",
    amount_minor: -1000
  }, {
    date: "2026-02-28",
    amount_minor: -1000
  }]]);

  assert.deepEqual([chart.lowest, chart.highest], [-1000, 3000]);
  assert.ok(chart.zero !== null && chart.series[0][0].y < chart.zero && chart.zero < chart.series[1][0].y);
  assert.equal(chart.series[1][0].y, chart.series[1][1].y);
  assert.equal(plotSeries([[{
    date: "2026-01-31",
    amount_minor: 1000
  }]]).zero, null);
});


test("monthly net worth includes manual-ledger balances after their snapshots have been migrated", async context => {
  const db = await seededDatabase(context);
  const before = await readNetWorthHistory(month("2026-02"), "EUR");

  await db.insert(schema.accounts).values({
    id: "manual-investment",
    environment: "SANDBOX",
    name: "Synthetic manual investment",
    institution: "Example institution",
    kind: "investment",
    currency: "EUR",
    provider: "manual"
  });
  await db.insert(schema.transactions).values([
    { id: "ledger-opening", booking_date: "2025-12-10", amount_minor: 50000, currency: "EUR", type: "opening_balance" as const },
    { id: "ledger-expense", booking_date: "2026-01-15", amount_minor: -5000, currency: "EUR", type: "expense" as const },
    { id: "ledger-adjustment", booking_date: "2026-02-12", amount_minor: 15000, currency: "EUR", type: "adjustment" as const },
    { id: "ledger-wrong-currency", booking_date: "2026-01-20", amount_minor: 99999, currency: "USD", type: "income" as const },
    { id: "ledger-future", booking_date: "2099-01-20", amount_minor: 99999, currency: "EUR", type: "income" as const }
  ].map(entry => ({
    ...entry,
    account_id: "manual-investment",
    provider_reference: `manual:${entry.id}`,
    type_source: "manual" as const
  })));

  const after = await readNetWorthHistory(month("2026-02"), "EUR");

  assert.deepEqual(after.points.map((point, index) => [point.month, point.netWorth - before.points[index].netWorth, point.investments - before.points[index].investments]), [
    ["2025-12", 50000, 50000],
    ["2026-01", 45000, 45000],
    ["2026-02", 60000, 60000]
  ]);
  assert.deepEqual(after.points.map((point, index) => point.manual - before.points[index].manual), [1, 1, 1]);
  assert.deepEqual(after.points.map((point, index) => point.unvalued - before.points[index].unvalued), [0, 0, 0]);
});
