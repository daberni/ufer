import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Temporal } from "temporal-polyfill";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { readCashFlowHistory } from "../src/features/reports/server/cash-flow-query";

function booking(id: string, date: string, amount: number, type: "income" | "expense" | "transfer", extra: Partial<typeof schema.transactions.$inferInsert> = {}): typeof schema.transactions.$inferInsert {
  return {
    id,
    account_id: "checking",
    provider_reference: `bank:${id}`,
    date,
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
  await db.insert(schema.accounts).values({
    id: "checking",
    name: "Synthetic checking",
    kind: "checking",
    provider: "manual"
  });
  await db.insert(schema.transactions).values([
    booking("salary", "2025-03-01", 40000, "income"),
    booking("rent", "2025-12-31", -15000, "expense"),
    // Just before the batch, so it only continues the net area into the batch.
    booking("lead-in", "2024-12-15", 2500, "income"),
    // Hidden bookings and transfers never count, so they must not keep earlier batches loading.
    booking("hidden", "2023-05-10", -900, "expense", {
      suppressed_at: "2023-05-11T00:00:00Z"
    }),
    booking("transfer", "2023-06-10", -700, "transfer")
  ]);
}

test("a history batch covers the twelve months before the given month and reports earlier counted months", async context => {
  await seed(context);

  const batch = await readCashFlowHistory("EUR", Temporal.PlainYearMonth.from("2026-01"));

  assert.equal(batch.trend.length, 12);
  assert.equal(batch.trend[0].month, "2025-01");
  assert.equal(batch.trend[11].month, "2025-12");
  assert.equal(batch.trend.find(month => month.month === "2025-03")?.income, 40000);
  assert.equal(batch.trend[11].expenses, 15000);
  assert.deepEqual(batch.leadIn, {
    month: "2024-12",
    income: 2500,
    expenses: 0
  });
  assert.equal(batch.hasEarlier, true);
});

test("history stops where only hidden bookings and transfers remain", async context => {
  await seed(context);

  const lastBatch = await readCashFlowHistory("EUR", Temporal.PlainYearMonth.from("2025-01"));
  const beyond = await readCashFlowHistory("EUR", Temporal.PlainYearMonth.from("2024-01"));

  assert.equal(lastBatch.trend.length, 12);
  assert.equal(lastBatch.trend[11].income, 2500);
  assert.equal(lastBatch.hasEarlier, false);
  assert.deepEqual(beyond.trend, []);
  assert.equal(beyond.hasEarlier, false);
});
