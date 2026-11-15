import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { Temporal } from "temporal-polyfill";
import { allMonthsPeriod, currentMonth, monthPeriod, parsePeriod, periodFromJson, periodToJson, serializePeriod, trendMonths, type Period } from "../src/features/dashboard/period";
import { dashboardFilters } from "../src/features/dashboard/server/dashboard-filters";
import { readDashboardState } from "../src/features/dashboard/server/dashboard-query";

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

  assert.deepEqual(trendMonths(monthPeriod(Temporal.PlainYearMonth.from("2026-02")), march).map(String), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(trendMonths(allMonthsPeriod, march).map(String), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
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
    environment: "SANDBOX",
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
    counterparty: "Example employer"
  }, {
    id: "january-start",
    account_id: "checking",
    provider_reference: "synthetic-2",
    booking_date: "2026-01-01",
    amount_minor: -30000,
    currency: "EUR",
    counterparty: "Example landlord"
  }, {
    id: "january-end",
    account_id: "checking",
    provider_reference: "synthetic-3",
    booking_date: "2026-01-31",
    amount_minor: -20000,
    currency: "EUR",
    counterparty: "Example supermarket"
  }, {
    id: "february-start",
    account_id: "checking",
    provider_reference: "synthetic-4",
    booking_date: "2026-02-01",
    amount_minor: -5000,
    currency: "EUR",
    counterparty: "Example pharmacy"
  }]);
}

function spending(state: Awaited<ReturnType<typeof readDashboardState>>) {
  return state.breakdown.reduce((total, item) => total + Number(item.amount), 0);
}

test("a month period limits transactions, cash flow and spending to the same calendar month", async context => {
  await seededDatabase(context);
  const state = await readDashboardState(dashboardFilters(new URLSearchParams("period=2026-01")));

  assert.deepEqual(state.period, {
    kind: "month",
    month: "2026-01"
  });
  assert.equal(state.transactionCount, 2);
  assert.deepEqual(state.transactions.map(item => item.id), ["january-end", "january-start"]);
  assert.equal(state.summary.income, 0);
  assert.equal(state.summary.expenses, 50000);
  assert.equal(spending(state), 50000);
  assert.deepEqual(state.trend.map(item => item.month), ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  assert.deepEqual(state.trend.slice(-2), [{
    month: "2025-12",
    income: 100000,
    expenses: 0
  }, {
    month: "2026-01",
    income: 0,
    expenses: 50000
  }]);
});

test("the all-months period applies to cash flow and spending as well as the transaction list", async context => {
  await seededDatabase(context);
  const state = await readDashboardState(dashboardFilters(new URLSearchParams("period=all")));

  assert.deepEqual(state.period, {
    kind: "all"
  });
  assert.equal(state.transactionCount, 4);
  assert.equal(state.summary.income, 100000);
  assert.equal(state.summary.expenses, 55000);
  assert.equal(spending(state), 55000);
  assert.equal(state.trend.length, 6);
  assert.equal(state.trend.at(-1)?.month, currentMonth().toString());
});
