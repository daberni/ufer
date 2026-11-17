import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { allMonthsPeriod, monthPeriod } from "../src/lib/period";
import { HttpError } from "../src/lib/errors";
import { readAccountCashFlow } from "../src/features/reports/server/cash-flow-query";
import { readBalanceHistory } from "../src/features/accounts/server/account-queries";
import { plotBalances } from "../src/features/accounts/balance-chart";
import { accountHref, accountIdFromPathname, isPeriodAware, periodScope, sectionOf, viewFromPathname, viewQuery } from "../src/client/app-location";

const january = monthPeriod(Temporal.PlainYearMonth.from("2026-01"));

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
  await db.insert(schema.accounts).values([{
    id: "checking",
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  }, {
    id: "savings",
    environment: "SANDBOX",
    name: "Synthetic savings",
    institution: "Example institution",
    kind: "savings"
  }, {
    id: "production-checking",
    environment: "PRODUCTION",
    name: "Synthetic production checking",
    institution: "Example institution",
    kind: "checking"
  }]);

  const entries: [string, string, string, number, string | null][] = [
    ["checking", "2026-01-02", "EUR", 250000, null],
    ["checking", "2026-01-05", "EUR", -4000, "groceries"],
    ["checking", "2026-01-10", "EUR", -50000, "transfer"],
    ["checking", "2026-01-12", "EUR", 10000, "transfer"],
    ["checking", "2026-01-20", "USD", -9900, "groceries"],
    ["checking", "2026-02-01", "EUR", -700, null],
    ["savings", "2026-01-10", "EUR", 50000, "transfer"],
    ["production-checking", "2026-01-03", "EUR", 70000, null]
  ];

  await db.insert(schema.transactions).values(entries.map(([accountId, bookingDate, currency, amount, categoryId], index) => ({
    id: `entry-${index}`,
    account_id: accountId,
    provider_reference: `synthetic-${index}`,
    booking_date: bookingDate,
    amount_minor: amount,
    currency,
    category_id: categoryId
  })));
  await db.insert(schema.balanceSnapshots).values([{
    id: "snapshot-2",
    account_id: "checking",
    observed_at: "2026-02-01",
    amount_minor: 205300,
    source: "sync"
  }, {
    id: "snapshot-1",
    account_id: "checking",
    observed_at: "2025-12-31",
    amount_minor: 0,
    source: "manual"
  }, {
    id: "snapshot-savings",
    account_id: "savings",
    observed_at: "2026-01-10",
    amount_minor: 50000,
    source: "csv"
  }]);

  return db;
}

async function assertNotFound(read: Promise<unknown>) {
  await assert.rejects(read, (error: unknown) => error instanceof HttpError && error.status === 404);
}

test("an account's cash flow counts its own transactions in its currency and reports transfers apart from income and spending", async context => {
  await seededDatabase(context);

  assert.deepEqual(await readAccountCashFlow("checking", january), {
    period: {
      kind: "month",
      month: "2026-01"
    },
    currency: "EUR",
    income: 250000,
    expenses: 4000,
    transfersIn: 10000,
    transfersOut: 50000
  });
  assert.equal((await readAccountCashFlow("checking", allMonthsPeriod)).expenses, 4700);
  assert.deepEqual(await readAccountCashFlow("savings", january), {
    period: {
      kind: "month",
      month: "2026-01"
    },
    currency: "EUR",
    income: 0,
    expenses: 0,
    transfersIn: 50000,
    transfersOut: 0
  });
});

test("an account without transactions in the period has zero flows, while unknown accounts and other environments are not found", async context => {
  await seededDatabase(context);
  const december = monthPeriod(Temporal.PlainYearMonth.from("2025-12"));
  const empty = await readAccountCashFlow("checking", december);

  assert.deepEqual([empty.income, empty.expenses, empty.transfersIn, empty.transfersOut], [0, 0, 0, 0]);
  await assertNotFound(readAccountCashFlow("unknown", january));
  await assertNotFound(readAccountCashFlow("production-checking", january));
});

test("an account's balance history lists only its own balances, oldest first, and other environments are not found", async context => {
  await seededDatabase(context);

  assert.deepEqual(await readBalanceHistory("checking"), {
    currency: "EUR",
    balances: [{
      date: "2025-12-31",
      amount_minor: 0,
      source: "manual"
    }, {
      date: "2026-02-01",
      amount_minor: 205300,
      source: "sync"
    }]
  });
  await assertNotFound(readBalanceHistory("unknown"));
  await assertNotFound(readBalanceHistory("production-checking"));
});

test("balances are spaced by date, and a flat or single balance stays inside the plot", () => {
  const plotted = plotBalances([{
    date: "2026-01-01",
    amount_minor: 1000,
    source: "manual"
  }, {
    date: "2026-01-04",
    amount_minor: 3000,
    source: "sync"
  }, {
    date: "2026-01-11",
    amount_minor: 2000,
    source: "sync"
  }]);

  assert.deepEqual(plotted.points.map(point => point.x), [0, 30, 100]);
  assert.ok(plotted.points[1].y < plotted.points[2].y && plotted.points[2].y < plotted.points[0].y);
  assert.deepEqual([plotted.lowest, plotted.highest], [1000, 3000]);

  for (const balances of [[1000, 1000], [0, 0], [-500]]) {
    const flat = plotBalances(balances.map((amount, index) => ({
      date: `2026-01-0${index + 1}`,
      amount_minor: amount,
      source: "sync" as const
    })));

    for (const point of flat.points) {
      assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= 100, String(balances));
      assert.equal(point.y, 50, String(balances));
    }
  }
});

test("an account's details path selects its transactions, keeps the period and belongs to accounts", () => {
  const params = new URLSearchParams("period=2026-01&currency=USD&search=rent&category=home&page=2");
  const scope = periodScope(params);
  const query = viewQuery("/accounts/acc-1", scope, params);

  assert.equal(viewFromPathname("/accounts/acc-1"), "account");
  assert.equal(viewFromPathname("/accounts"), "accounts");
  assert.equal(viewFromPathname("/accounts/acc-1/more"), "overview");
  assert.equal(accountIdFromPathname("/accounts/%E0"), "");
  assert.equal(sectionOf("account"), "accounts");
  assert.ok(isPeriodAware("account"));
  assert.deepEqual([query.account, query.search, query.category, query.page], ["acc-1", "", "", 2]);
  assert.equal(accountHref("acc 1", "period=2026-01"), "/accounts/acc%201?period=2026-01");
  assert.equal(viewQuery(new URL(accountHref("acc 1", ""), "http://localhost").pathname, "", new URLSearchParams()).account, "acc 1");
});
