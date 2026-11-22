import assert from "node:assert/strict";
import { test } from "node:test";
import { Temporal } from "temporal-polyfill";
import type { Database } from "../src/server/database/connection";
import * as schema from "../src/server/database/schema";
import { listAccounts, readBalanceHistory, readNetWorth } from "../src/features/accounts/server/account-queries";
import { readNetWorthHistory } from "../src/features/reports/server/net-worth-history-query";
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

async function brokerageRow(accountId: string, at = now) {
  const account = (await listAccounts(at)).find(item => item.id === accountId);

  assert.ok(account);

  return account;
}

async function holdings(context: Parameters<typeof isolatedDatabase>[0]) {
  const db = await isolatedDatabase(context);
  const cash = await settlementAccount();
  const account = await depot();
  const etf = await security();

  await trade(account, {
    security_id: etf,
    date: "2026-09-10",
    side: "buy",
    quantity: "10",
    price: "100",
    settlement: {
      account_id: cash
    }
  });

  return {
    db,
    cash,
    account,
    etf
  };
}

test("a brokerage account's balance is its holdings at the latest price, without any transaction", async context => {
  const {
    db,
    account,
    etf
  } = await holdings(context);

  await price(db, etf, "2026-10-29", 110);
  await price(db, etf, "2026-10-30", 112.5);

  const row = await brokerageRow(account);

  assert.deepEqual([row.balance_minor, row.balance_date, row.valuation], [1125_00, "2026-10-31", {
    missing: 0,
    stale: 0
  }]);
  assert.equal((await db.select().from(schema.transactions)).filter(booking => booking.account_id === account).length, 0);
});

test("a holding without any price counts nothing and is reported missing; an old price counts and is reported stale", async context => {
  const {
    db,
    account,
    etf
  } = await holdings(context);

  assert.deepEqual([(await brokerageRow(account)).balance_minor, (await brokerageRow(account)).valuation], [0, {
    missing: 1,
    stale: 0
  }]);

  await price(db, etf, "2026-10-20", 105);

  assert.deepEqual([(await brokerageRow(account)).balance_minor, (await brokerageRow(account)).valuation], [1050_00, {
    missing: 0,
    stale: 1
  }]);
  assert.equal((await readNetWorth("EUR", now)).incompleteValuations, 1);
});

test("a brokerage account without trades has no balance", async context => {
  await isolatedDatabase(context);
  const account = await depot();
  const row = await brokerageRow(account);

  assert.deepEqual([row.balance_minor, row.valuation], [null, null]);
});

test("the balance history values each day with the price valid then and never a later one, including splits", async context => {
  const {
    db,
    account,
    etf
  } = await holdings(context);

  await price(db, etf, "2026-09-09", 99);
  await price(db, etf, "2026-09-11", 101);
  await price(db, etf, "2026-10-01", 60);
  await db.insert(schema.securitySplits).values({
    security_id: etf,
    date: "2026-10-01",
    numerator: 2,
    denominator: 1
  });

  const { balances } = await readBalanceHistory(account, now);

  assert.deepEqual(balances.map(point => [point.date, point.amount_minor, point.source]), [
    ["2026-09-09", 0, "valuation"],
    // On the trade date the newest price is the one from the day before.
    ["2026-09-10", 990_00, "valuation"],
    ["2026-09-11", 1010_00, "valuation"],
    // From the split the 20 units are valued at the post-split price.
    ["2026-10-01", 1200_00, "valuation"],
    ["2026-10-31", 1200_00, "valuation"]
  ]);
});

test("net worth counts settlement cash and holdings once, and its history uses each month's own prices", async context => {
  const {
    db,
    etf
  } = await holdings(context);

  await price(db, etf, "2026-09-30", 102);
  await price(db, etf, "2026-10-30", 120);

  const netWorth = await readNetWorth("EUR", now);

  // 5000.00 opening balance less the 1000.00 buy on the settlement account, plus 10 units at 120.00.
  assert.deepEqual([netWorth.liquidity, netWorth.investments, netWorth.netWorth], [4000_00, 1200_00, 5200_00]);

  const history = await readNetWorthHistory("EUR", now);
  const september = history.points.find(point => point.date === "2026-09-30");
  const current = history.points.at(-1);

  assert.deepEqual([september?.categories.investments, september?.categories.liquidity], [1020_00, 4000_00]);
  assert.deepEqual([current?.date, current?.categories.investments], ["2026-10-31", 1200_00]);

  const august = history.points.find(point => point.date === "2026-08-31");

  assert.equal(august?.categories.investments, 0);
});

test("a later valuation date picks up a newer price while an earlier one keeps the old value", async context => {
  const {
    db,
    account,
    etf
  } = await holdings(context);

  await price(db, etf, "2026-10-30", 110);
  await price(db, etf, "2026-11-05", 130);

  assert.equal((await brokerageRow(account, now)).balance_minor, 1100_00);
  assert.equal((await brokerageRow(account, Temporal.Instant.from("2026-11-06T12:00:00Z"))).balance_minor, 1300_00);
});
