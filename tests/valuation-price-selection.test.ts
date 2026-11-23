import assert from "node:assert/strict";
import { test } from "node:test";
import { Temporal } from "temporal-polyfill";
import { asc } from "drizzle-orm";
import type { Database } from "../src/server/database/connection";
import * as schema from "../src/server/database/schema";
import { listAccounts, readBalanceHistory } from "../src/features/accounts/server/account-queries";
import { readNetWorthHistory } from "../src/features/reports/server/net-worth-history-query";
import { netWorthSeries } from "../src/features/reports/net-worth-series";
import { readBrokeragePerformance, readBrokerageTrades, readCombinedBrokeragePerformance } from "../src/features/securities/server/security-service";
import { readHoldingInputs, type AccountValuationInputs } from "../src/features/securities/server/valuation-repository";
import { changeSummary, valuationSeries, valueHoldings } from "../src/features/securities/valuation";
import { performanceSeries } from "../src/features/securities/performance";
import { isolatedDatabase } from "./fixtures/brokerage";
import { seedPriceHistory } from "./fixtures/price-history";

// Today, a Sunday after one fund's prices stopped, a day early in the trades and a day before any trade.
const valuationDays = ["2026-10-31", "2025-06-15", "2022-03-01", "2021-06-01"];

function instantOn(date: string) {
  return Temporal.PlainDate.from(date).toZonedDateTime({
    timeZone: "UTC",
    plainTime: "12:00"
  }).toInstant();
}

/** Every account's inputs with each security's complete stored price history, as valuations read them before closes were selected. */
async function completeInputs(db: Database, accountIds: string[], date: string) {
  const prices = await db.select().from(schema.securityPrices).orderBy(asc(schema.securityPrices.date));
  const inputs = await readHoldingInputs(accountIds, {
    kind: "latest",
    date,
    count: 1
  });

  for (const account of inputs.values()) {
    for (const holding of account.holdings) {
      holding.prices = prices.filter(price => price.security_id === holding.security_id).map(price => ({
        security_id: price.security_id,
        date: price.date,
        close_micros: price.close_micros
      }));
    }
  }

  return (id: string): AccountValuationInputs => inputs.get(id) ?? {
    holdings: [],
    settlements: []
  };
}

test("valuations read only the selected closes and report the same figures as with every stored close", async context => {
  const db = await isolatedDatabase(context);
  const { accounts } = await seedPriceHistory(db);

  for (const date of valuationDays) {
    const now = instantOn(date);
    const complete = await completeInputs(db, accounts, date);
    const listed = await listAccounts(now);

    for (const id of accounts) {
      const {
        holdings,
        settlements
      } = complete(id);
      const expected = valueHoldings(holdings, date);
      const row = listed.find(account => account.id === id);
      const trades = await readBrokerageTrades(id, now);
      const performance = await readBrokeragePerformance(id, now);

      assert.deepEqual([row?.balance_minor, row?.valuation], [expected.value_minor, {
        missing: expected.missing,
        stale: expected.stale
      }], `listed value of ${id} on ${date}`);
      assert.deepEqual([trades.valuation, trades.summary], [expected, changeSummary(holdings, date)], `holdings of ${id} on ${date}`);
      assert.deepEqual((await readBalanceHistory(id, now)).balances.map(point => [point.date, point.amount_minor]), valuationSeries(holdings, settlements, date).map(point => [point.date, point.amount_minor]), `balance history of ${id} on ${date}`);
      assert.deepEqual([performance.missing, performance.points], [expected.missing, performanceSeries(holdings, date)], `performance of ${id} on ${date}`);
    }

    const combined = complete(accounts[0]!).holdings.concat(complete(accounts[1]!).holdings);
    const [euro] = (await readCombinedBrokeragePerformance(now)).currencies;

    assert.deepEqual([euro?.points, euro?.summary], [performanceSeries(combined, date), changeSummary(combined, date)], `combined performance on ${date}`);

    const relevant = listed.filter(account => account.currency === "EUR" && account.kind !== "brokerage");
    const balances = [
      ...await Promise.all(relevant.map(async account => ({
        kind: account.kind,
        currency: account.currency,
        current_minor: account.balance_minor,
        balances: (await readBalanceHistory(account.id, now)).balances
      }))),
      ...accounts.map(id => ({
        kind: "brokerage",
        currency: "EUR",
        current_minor: listed.find(account => account.id === id)?.balance_minor ?? null,
        balances: valuationSeries(complete(id).holdings, complete(id).settlements, date)
      }))
    ];

    assert.deepEqual((await readNetWorthHistory("EUR", now)).points, netWorthSeries(balances, "EUR", date), `net-worth history on ${date}`);
  }
});

test("a current value reads at most the two newest closes per security and a sampled history one close per date", async context => {
  const db = await isolatedDatabase(context);
  const { accounts } = await seedPriceHistory(db);
  const dates = ["2023-01-31", "2024-02-29", "2026-10-31"];
  const latest = await readHoldingInputs(accounts, {
    kind: "latest",
    date: "2026-10-31",
    count: 2
  });
  const sampled = await readHoldingInputs(accounts, {
    kind: "dates",
    dates
  });
  const history = await readHoldingInputs(accounts, {
    kind: "history",
    through: "2026-10-31"
  });
  const pricesOf = (inputs: Map<string, AccountValuationInputs>) => [...inputs.values()].flatMap(account => account.holdings.map(holding => holding.prices.map(price => price.date)));

  assert.deepEqual(pricesOf(latest).map(dates => dates.length), [2, 2, 2, 0, 2, 2]);
  assert.ok(pricesOf(sampled).every(prices => prices.length <= dates.length));
  // The history starts at the second-newest close on or before the first trade on Monday 2022-02-14, not with the closes imported since 2021.
  assert.deepEqual(pricesOf(history).map(prices => prices[0]), ["2022-02-11", "2022-02-11", "2022-02-11", undefined, "2022-02-11", "2022-02-11"]);
});
