import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { readInsights, readNetWorthChange } from "../src/features/insights/server/insights-query";
import { changeInterval, comparisonSpans, parseRange, precedingRanges, serializeRange, shiftRange, spanToJson } from "../src/lib/period-range";

// 2026-11-25 midday in the product time zone.
const now = Temporal.Instant.from("2026-11-25T11:00:00Z");
const today = Temporal.PlainDate.from("2026-11-25");

function range(value: string) {
  const parsed = parseRange(value);

  assert.ok(parsed, value);

  return parsed;
}

test("ranges round-trip through their URL form and reject other forms", () => {
  for (const value of ["2026-11", "2026-Q4", "2026", "2026-01-05..2026-03-04"]) {
    assert.equal(serializeRange(range(value)), value);
  }

  assert.deepEqual(spanToJson(range("2026-Q1")), {
    start: "2026-01-01",
    end: "2026-03-31"
  });

  for (const value of ["2026-13", "2026-Q5", "26", "2026-02-30..2026-03-01", "2026-01-01", "2000-01-01..2026-01-01"]) {
    assert.equal(parseRange(value), null, value);
  }
});

test("a custom range steps by its own length and columns precede the selected range", () => {
  const custom = range("2026-01-05..2026-01-14");

  assert.equal(serializeRange(shiftRange(custom, -1)), "2025-12-26..2026-01-04");
  assert.deepEqual(precedingRanges(range("2026-Q1"), 3).map(serializeRange), ["2025-Q3", "2025-Q4", "2026-Q1"]);
  assert.deepEqual(precedingRanges(range("2026-03"), 2).map(serializeRange), ["2026-02", "2026-03"]);
});

test("a running range compares with the same number of days of the previous interval", () => {
  const month = comparisonSpans(range("2026-11"), today);

  assert.equal(month.partial, true);
  assert.deepEqual(spanToJson(month.current), {
    start: "2026-11-01",
    end: "2026-11-25"
  });
  assert.deepEqual(spanToJson(month.previous), {
    start: "2026-10-01",
    end: "2026-10-25"
  });

  // Q4 to date is 56 days, so Q3 contributes its first 56 days.
  const quarter = comparisonSpans(range("2026-Q4"), today);

  assert.deepEqual(spanToJson(quarter.previous), {
    start: "2026-07-01",
    end: "2026-08-25"
  });

  // The last day of a long month never reaches past the end of a shorter previous month.
  const march = comparisonSpans(range("2026-03"), Temporal.PlainDate.from("2026-03-31"));

  assert.deepEqual(spanToJson(march.previous), {
    start: "2026-02-01",
    end: "2026-02-28"
  });

  const finished = comparisonSpans(range("2026-10"), today);

  assert.equal(finished.partial, false);
  assert.deepEqual(spanToJson(finished.previous), {
    start: "2026-09-01",
    end: "2026-09-30"
  });
});

test("switching the interval keeps the range's point in time", () => {
  assert.equal(serializeRange(changeInterval(range("2026-11"), "quarter", today)), "2026-Q4");
  assert.equal(serializeRange(changeInterval(range("2026"), "month", today)), "2026-11");
  assert.equal(serializeRange(changeInterval(range("2025"), "quarter", today)), "2025-Q4");
  assert.equal(serializeRange(changeInterval(range("2026-Q2"), "custom", today)), "2026-04-01..2026-06-30");
});

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
  await db.insert(schema.categories).values({
    id: "synthetic-rent",
    name: "Synthetic rent",
    color: "#7d6fa8"
  }).onConflictDoNothing();

  let count = 0;
  const booking = (date: string, amount: number, type: "income" | "expense" | "transfer" | "opening_balance", category: string | null = null): typeof schema.transactions.$inferInsert => {
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
      category_id: category
    };
  };

  await db.insert(schema.transactions).values([
    booking("2026-01-01", 100000, "opening_balance"),
    // Q3: two salaries and groceries, one of them after the 56 days Q4 has run.
    booking("2026-07-10", 300000, "income"),
    booking("2026-08-20", -20000, "expense", "groceries"),
    booking("2026-09-10", -15000, "expense", "groceries"),
    // October: the 26th lies beyond the 25 days November has run.
    booking("2026-10-05", 300000, "income"),
    booking("2026-10-20", -40000, "expense", "groceries"),
    booking("2026-10-26", -90000, "expense", "synthetic-rent"),
    // November so far; a transfer never counts.
    booking("2026-11-05", 310000, "income"),
    booking("2026-11-10", -50000, "expense", "groceries"),
    booking("2026-11-11", -70000, "transfer")
  ]);
}

test("insights read one column per interval and compare a running month with the same days of the previous month", async context => {
  await seed(context);

  const insights = await readInsights(range("2026-11"), "EUR", now);
  const october = insights.columns.at(-2);
  const november = insights.columns.at(-1);

  assert.equal(insights.columns.length, 12);
  assert.equal(insights.columns[0].start, "2025-12-01");
  assert.deepEqual([october?.start, october?.end, october?.income, october?.expenses], ["2026-10-01", "2026-10-31", 300000, 130000]);
  assert.deepEqual([november?.income, november?.expenses], [310000, 50000]);
  assert.equal(insights.comparison.partial, true);
  // October's rent on the 26th is outside the first 25 days.
  assert.deepEqual([insights.comparison.previous.income, insights.comparison.previous.expenses], [300000, 40000]);
  assert.deepEqual(insights.comparison.previous.expenseBreakdown.map(row => [row.categoryId, row.amount]), [["groceries", 40000]]);
  assert.deepEqual([insights.comparison.current.income, insights.comparison.current.expenses], [310000, 50000]);
});

test("quarter columns group whole quarters and the running quarter compares with the first days of the previous one", async context => {
  await seed(context);

  const insights = await readInsights(range("2026-Q4"), "EUR", now);
  const q3 = insights.columns.at(-2);

  assert.deepEqual([q3?.start, q3?.end, q3?.income, q3?.expenses], ["2026-07-01", "2026-09-30", 300000, 35000]);
  assert.deepEqual([insights.comparison.previous.income, insights.comparison.previous.expenses], [300000, 20000]);
  assert.deepEqual([insights.columns.at(-1)?.income, insights.columns.at(-1)?.expenses], [610000, 180000]);
});

test("net-worth change covers the compared spans and is unknown for a range that has not started", async context => {
  await seed(context);

  const month = await readNetWorthChange(range("2026-11"), "EUR", now);

  // November so far: salary minus groceries minus the transfer out of the account.
  assert.equal(month.current, 310000 - 50000 - 70000);
  assert.equal(month.previous, 300000 - 40000);

  const future = await readNetWorthChange(range("2027-01"), "EUR", now);

  assert.equal(future.current, null);
  assert.equal(future.previous, null);
});
