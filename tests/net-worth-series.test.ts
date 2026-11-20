import assert from "node:assert/strict";
import { test } from "node:test";
import { netWorthSeries, type AccountBalanceSeries } from "../src/features/reports/net-worth-series";

const endDate = "2026-11-20";

function amounts(accounts: AccountBalanceSeries[], currency = "EUR") {
  return netWorthSeries(accounts, currency, endDate).map(point => [point.date, point.amount_minor]);
}

test("sums the accounts at each month end and ends at the current net worth", () => {
  const checking = {
    currency: "EUR",
    current_minor: 150_00,
    balances: [{
      date: "2025-12-15",
      amount_minor: 100_00
    }, {
      date: "2026-10-31",
      amount_minor: 140_00
    }]
  };
  const loan = {
    currency: "EUR",
    current_minor: -60_00,
    balances: [{
      date: "2025-11-01",
      amount_minor: -80_00
    }, {
      date: "2026-06-30",
      amount_minor: -70_00
    }]
  };
  const series = amounts([checking, loan]);

  assert.equal(series.length, 12);
  assert.deepEqual(series[0], ["2025-12-31", 100_00 - 80_00]);
  assert.deepEqual(series[6], ["2026-06-30", 100_00 - 70_00]);
  assert.deepEqual(series[10], ["2026-10-31", 140_00 - 70_00]);
  assert.deepEqual(series[11], [endDate, 150_00 - 60_00]);
});

test("counts an account only from its first known balance", () => {
  const existing = {
    currency: "EUR",
    current_minor: 100_00,
    balances: [{
      date: "2025-01-01",
      amount_minor: 100_00
    }]
  };
  const lateDepot = {
    currency: "EUR",
    current_minor: 500_00,
    balances: [{
      date: "2026-08-10",
      amount_minor: 500_00
    }]
  };
  const series = amounts([existing, lateDepot]);

  assert.deepEqual(series[7], ["2026-07-31", 100_00]);
  assert.deepEqual(series[8], ["2026-08-31", 600_00]);
  assert.deepEqual(series[11], [endDate, 600_00]);
});

test("counts only accounts in the selected currency", () => {
  const euro = {
    currency: "EUR",
    current_minor: 10_00,
    balances: []
  };
  const dollar = {
    currency: "USD",
    current_minor: 99_00,
    balances: [{
      date: "2026-01-01",
      amount_minor: 50_00
    }]
  };

  assert.deepEqual(amounts([euro, dollar]).at(-1), [endDate, 10_00]);
  assert.ok(amounts([euro, dollar]).slice(0, -1).every(([, amount]) => amount === 0));
  assert.deepEqual(amounts([euro, dollar], "USD")[1], ["2026-01-31", 50_00]);
  assert.deepEqual(amounts([euro, dollar], "USD").at(-1), [endDate, 99_00]);
  assert.deepEqual(amounts([euro], "CHF"), []);
});
