import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Temporal } from "temporal-polyfill";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { readBrokerageHolding } from "../src/features/securities/server/security-service";
import { HttpError } from "../src/lib/errors";

const now = Temporal.Instant.from("2026-10-14T06:00:00Z");

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previous = globals.budgetDb;

  context.after(() => {
    globals.budgetDb = previous;
    client.close();
  });
  await initializeDatabase(client);

  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  await db.insert(schema.accounts).values([{
    id: "depot",
    name: "Synthetic depot",
    kind: "brokerage"
  }, {
    id: "other",
    name: "Synthetic other depot",
    kind: "brokerage"
  }]);
  await db.insert(schema.securities).values([{
    id: "etf",
    name: "Synthetic World ETF",
    currency: "EUR"
  }, {
    id: "bond",
    name: "Synthetic Bond Fund",
    currency: "EUR"
  }]);
  await db.insert(schema.securityTrades).values([{
    id: "etf-buy",
    account_id: "depot",
    security_id: "etf",
    date: "2026-09-01",
    side: "buy",
    sequence: 1,
    quantity_micros: 10_000_000,
    price_micros: 100_000_000,
    gross_minor: 1000_00
  }, {
    id: "bond-buy",
    account_id: "depot",
    security_id: "bond",
    date: "2026-09-02",
    side: "buy",
    sequence: 2,
    quantity_micros: 5_000_000,
    price_micros: 50_000_000,
    gross_minor: 250_00
  }, {
    id: "etf-sell",
    account_id: "depot",
    security_id: "etf",
    date: "2026-10-01",
    side: "sell",
    sequence: 3,
    quantity_micros: 4_000_000,
    price_micros: 110_000_000,
    gross_minor: 440_00
  }, {
    id: "bond-elsewhere",
    account_id: "other",
    security_id: "bond",
    date: "2026-09-03",
    side: "buy",
    sequence: 1,
    quantity_micros: 1_000_000,
    price_micros: 50_000_000,
    gross_minor: 50_00
  }]);
  await db.insert(schema.securityPrices).values([["etf", "2026-09-30", 108_000_000], ["etf", "2026-10-13", 112_000_000], ["etf", "2026-10-12", 111_000_000], ["bond", "2026-10-13", 51_000_000]].map(([security, date, close]) => ({
    security_id: String(security),
    date: String(date),
    close_micros: Number(close),
    source: "test",
    fetched_at: "2026-10-13T20:00:00Z"
  })));
}

test("a holding lists only its own trades and its security's closes, newest first", async context => {
  await isolatedDatabase(context);

  const detail = await readBrokerageHolding("depot", "etf", now);

  assert.deepEqual(detail.trades.map(trade => trade.id), ["etf-sell", "etf-buy"]);
  assert.deepEqual(detail.prices, [{
    date: "2026-10-13",
    close_micros: 112_000_000
  }, {
    date: "2026-10-12",
    close_micros: 111_000_000
  }, {
    date: "2026-09-30",
    close_micros: 108_000_000
  }]);
  assert.equal(detail.holding.quantity_micros, 6_000_000);
  assert.equal(detail.holding.value_minor, 672_00);
  assert.equal(detail.trades[0]!.realized_minor, 440_00 - 400_00);
});

test("a security the account never traded is not one of its holdings", async context => {
  await isolatedDatabase(context);

  await assert.rejects(readBrokerageHolding("other", "etf", now), (error: unknown) => error instanceof HttpError && error.status === 404);
  assert.deepEqual((await readBrokerageHolding("other", "bond", now)).trades.map(trade => trade.id), ["bond-elsewhere"]);
});

test("closes before a split are shown in the units held after it, so the split is no price change", async context => {
  await isolatedDatabase(context);
  const db = await (globalThis as unknown as {
    budgetDb: Promise<Database>
  }).budgetDb;

  await db.insert(schema.securitySplits).values({
    security_id: "etf",
    date: "2026-10-12",
    numerator: 2,
    denominator: 1
  });

  const detail = await readBrokerageHolding("depot", "etf", now);

  assert.deepEqual(detail.prices.map(price => price.close_micros), [112_000_000, 111_000_000, 54_000_000]);
});
