import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Database } from "../src/server/database/connection";
import * as schema from "../src/server/database/schema";
import { readBrokeragePerformance, readCombinedBrokeragePerformance } from "../src/features/securities/server/security-service";
import { performanceInRange, pricesInRange } from "../src/features/securities/performance-range";
import { depot, isolatedDatabase, now, security, settlementAccount, trade } from "./fixtures/brokerage";

async function price(db: Database, securityId: string, date: string, close: number) {
  await db.insert(schema.securityPrices).values({
    security_id: securityId,
    date,
    close_micros: close * 1_000_000,
    source: "test",
    fetched_at: `${date}T20:00:00.000Z`
  });
}

async function setup(context: Parameters<typeof isolatedDatabase>[0]) {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const account = await depot();
  const etf = await security();

  function record(date: string, side: "buy" | "sell", quantity: string, unitPrice: string, fee = "0") {
    return trade(account, {
      security_id: etf,
      date,
      side,
      quantity,
      price: unitPrice,
      fee,
      settlement: {
        account_id: cash
      }
    });
  }

  return {
    db,
    account,
    etf,
    record
  };
}

function rounded(ratio: number) {
  return Math.round(ratio * 10_000) / 10_000;
}

test("buys and partial sales do not count as performance; only price changes do", async context => {
  const {
    db,
    account,
    etf,
    record
  } = await setup(context);

  await price(db, etf, "2026-09-10", 100);
  await record("2026-09-10", "buy", "10", "100");
  await price(db, etf, "2026-09-20", 110);
  await record("2026-09-25", "buy", "10", "110");
  await price(db, etf, "2026-10-01", 121);
  await record("2026-10-05", "sell", "5", "121");

  const { points } = await readBrokeragePerformance(account, now);
  const last = points[points.length - 1];

  assert.deepEqual(points.map(point => [point.date, point.value_minor, point.invested_minor, rounded(point.growth)]), [
    ["2026-09-09", 0, 0, 1],
    ["2026-09-10", 1000_00, 1000_00, 1],
    ["2026-09-20", 1100_00, 1000_00, 1.1],
    // The second buy doubles the value but not the return.
    ["2026-09-25", 2200_00, 2100_00, 1.1],
    ["2026-10-01", 2420_00, 2100_00, 1.21],
    ["2026-10-05", 1815_00, 1495_00, 1.21],
    ["2026-10-31", 1815_00, 1495_00, 1.21]
  ]);
  // The money gain is the value less what is still invested: 1,815 − 1,495.
  assert.equal(last.value_minor - last.invested_minor, 320_00);
});

test("fees reduce the return and a full sale above the last price keeps its gain", async context => {
  const {
    db,
    account,
    etf,
    record
  } = await setup(context);

  await price(db, etf, "2026-09-10", 100);
  await record("2026-09-10", "buy", "10", "100", "10");
  await record("2026-09-15", "sell", "10", "105");

  const { points } = await readBrokeragePerformance(account, now);

  assert.deepEqual(points.map(point => [point.date, point.value_minor, rounded(point.growth)]), [
    ["2026-09-09", 0, 1],
    // 1,000 held for 1,010 paid.
    ["2026-09-10", 1000_00, rounded(1000 / 1010)],
    // Sold for 1,050 after holding 1,000; with nothing held afterwards the series ends here.
    ["2026-09-15", 0, rounded(1000 / 1010 * 1.05)]
  ]);
});

test("a split keeps the return unchanged and no point uses a price dated after it", async context => {
  const {
    db,
    account,
    etf,
    record
  } = await setup(context);

  await price(db, etf, "2026-09-10", 100);
  await record("2026-09-10", "buy", "10", "100");
  await db.insert(schema.securitySplits).values({
    security_id: etf,
    date: "2026-10-01",
    numerator: 2,
    denominator: 1
  });
  await price(db, etf, "2026-10-01", 50);
  await price(db, etf, "2026-10-20", 55);
  // A price after the valuation date must not reach the series.
  await price(db, etf, "2026-11-05", 80);

  const { points } = await readBrokeragePerformance(account, now);

  assert.deepEqual(points.map(point => [point.date, point.value_minor, rounded(point.growth)]), [
    ["2026-09-09", 0, 1],
    ["2026-09-10", 1000_00, 1],
    ["2026-10-01", 1000_00, 1],
    ["2026-10-20", 1100_00, 1.1],
    ["2026-10-31", 1100_00, 1.1]
  ]);
});

test("a range rebases return and gain to the value valid at its start", async context => {
  const {
    db,
    account,
    etf,
    record
  } = await setup(context);

  await price(db, etf, "2026-09-10", 100);
  await record("2026-09-10", "buy", "10", "100");
  await price(db, etf, "2026-09-20", 110);
  await record("2026-10-05", "buy", "10", "110");
  await price(db, etf, "2026-10-20", 121);

  const { points } = await readBrokeragePerformance(account, now);
  const month = performanceInRange(points, "1M");

  // From 30 Sep (value 1,100) the price rose 10 %; the buy on 5 Oct is not a gain.
  assert.deepEqual(month.map(point => [point.date, rounded(point.return_ratio), point.gain_minor]), [
    ["2026-09-30", 0, 0],
    ["2026-10-05", 0, 0],
    ["2026-10-20", 0.1, 220_00],
    ["2026-10-31", 0.1, 220_00]
  ]);
});

test("an account without trades has no performance", async context => {
  await isolatedDatabase(context);
  const account = await depot();

  assert.deepEqual((await readBrokeragePerformance(account, now)).points, []);
});

test("the combined performance adds up active accounts of one currency, keeps other currencies apart and keeps archived accounts' history out of today's figures and total return only", async context => {
  const db = await isolatedDatabase(context);
  const euroCash = await settlementAccount();
  const dollarCash = await settlementAccount("USD");
  const first = await depot();
  const second = await depot();
  const archived = await depot();
  const dollars = await depot("USD");
  const etf = await security();
  const usEtf = await security("USD", null);
  const archivedEtf = await security("EUR", null, "XS0000000017");
  const buy = (account: string, securityId: string, cash: string, quantity: string) => trade(account, {
    security_id: securityId,
    date: "2026-09-10",
    side: "buy",
    quantity,
    price: "100",
    fee: "0",
    settlement: {
      account_id: cash
    }
  });

  await price(db, etf, "2026-09-10", 100);
  await price(db, etf, "2026-10-30", 110);
  await price(db, usEtf, "2026-09-10", 100);
  await price(db, archivedEtf, "2026-09-10", 100);
  await price(db, archivedEtf, "2026-10-30", 200);
  await buy(first, etf, euroCash, "10");
  await buy(second, etf, euroCash, "5");
  await buy(archived, archivedEtf, euroCash, "100");
  await buy(dollars, usEtf, dollarCash, "1");
  await db.update(schema.accounts).set({
    archived_at: "2026-10-01T00:00:00.000Z"
  }).where(eq(schema.accounts.id, archived));

  const combined = await readCombinedBrokeragePerformance(now);
  const euro = combined.currencies.find(item => item.currency === "EUR")!;
  const dollar = combined.currencies.find(item => item.currency === "USD")!;
  const last = euro.points.at(-1)!;

  assert.equal(combined.currencies.length, 2);
  assert.deepEqual(euro.account_ids.toSorted(), [first, second].toSorted());
  // The series includes the archived account's history; its account list and today's summary do not.
  assert.equal(last.value_minor, 15 * 110_00 + 100 * 200_00);
  assert.equal(last.invested_minor, 115 * 100_00);
  assert.equal(euro.summary.total.gain_minor, 15 * 10_00);
  // The return beside that gain covers the same active accounts: 10 %, not the archived holding's doubling.
  assert.equal(Math.round((euro.total_return?.ratio ?? NaN) * 10_000) / 10_000, 0.1);
  assert.equal(euro.total_return?.since, "2026-09-10");
  assert.deepEqual(dollar.account_ids, [dollars]);
  assert.equal(dollar.points.at(-1)!.value_minor, 100_00);
});

test("a price range opens with the close valid on its start date and keeps every later close", () => {
  const prices = ["2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16"].map((date, index) => ({
    date,
    close_micros: (100 + index) * 1_000_000
  }));

  // One week before 2026-10-14 is 2026-10-07; the close valid then is the one from 2026-10-02.
  assert.deepEqual(pricesInRange(prices, "1W", "2026-10-14").map(price => price.date), ["2026-10-02", "2026-10-09", "2026-10-16"]);
  assert.deepEqual(pricesInRange(prices, "1W", "2026-10-02").map(price => price.date), ["2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16"]);
  assert.equal(pricesInRange(prices, "All", "2026-10-14"), prices);
});
