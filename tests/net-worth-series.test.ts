import assert from "node:assert/strict";
import { test } from "node:test";
import { netWorthChange, netWorthSeries, type AccountBalanceSeries } from "../src/features/reports/net-worth-series";

const endDate = "2026-11-20";

function amounts(accounts: AccountBalanceSeries[], currency = "EUR") {
  return netWorthSeries(accounts, currency, endDate).map(point => [point.date, point.amount_minor]);
}

test("sums the accounts at each month end and ends at the current net worth", () => {
  const checking = {
    kind: "checking",
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
    kind: "loan",
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
    kind: "checking",
    currency: "EUR",
    current_minor: 100_00,
    balances: [{
      date: "2025-01-01",
      amount_minor: 100_00
    }]
  };
  const lateDepot = {
    kind: "investment",
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
    kind: "checking",
    currency: "EUR",
    current_minor: 10_00,
    balances: []
  };
  const dollar = {
    kind: "checking",
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

test("splits each point into categories that add up to the net worth", () => {
  const accounts: AccountBalanceSeries[] = [{
    kind: "savings",
    currency: "EUR",
    current_minor: 300_00,
    balances: [{
      date: "2025-12-01",
      amount_minor: 200_00
    }]
  }, {
    kind: "credit_card",
    currency: "EUR",
    current_minor: -20_00,
    balances: [{
      date: "2025-12-01",
      amount_minor: -10_00
    }]
  }, {
    kind: "loan",
    currency: "EUR",
    current_minor: -900_00,
    balances: [{
      date: "2025-12-01",
      amount_minor: -1_000_00
    }]
  }, {
    kind: "property",
    currency: "EUR",
    current_minor: 5_000_00,
    balances: [{
      date: "2025-12-01",
      amount_minor: 4_500_00
    }]
  }, {
    kind: "cash",
    currency: "EUR",
    current_minor: 999_00,
    balances: []
  }];
  const series = netWorthSeries(accounts, "EUR", endDate);

  assert.deepEqual(series[0].categories, {
    liquidity: 190_00,
    investments: 0,
    property: 4_500_00,
    liabilities: -1_000_00
  });
  assert.equal(series[0].amount_minor, 190_00 + 4_500_00 - 1_000_00);
  assert.equal(series.at(-1)?.amount_minor, 280_00 + 5_000_00 - 900_00);
});

test("measures the change of the total and of each category from the first to the last point", () => {
  const point = (date: string, liquidity: number, investments: number, property: number, liabilities: number) => ({
    date,
    amount_minor: liquidity + investments + property + liabilities,
    categories: {
      liquidity,
      investments,
      property,
      liabilities
    }
  });
  const change = netWorthChange([
    point("2025-12-31", 1_000_00, 500_00, 0, -2_000_00),
    point("2026-06-30", 9_999_00, 0, 0, 0),
    point(endDate, 1_200_00, 450_00, 0, -1_800_00)
  ]);

  assert.deepEqual(change, {
    since: "2025-12",
    amount_minor: 200_00 - 50_00 + 200_00,
    categories: {
      liquidity: 200_00,
      investments: -50_00,
      property: 0,
      liabilities: 200_00
    }
  });
  assert.equal(netWorthChange([point(endDate, 1, 0, 0, 0)]), null);
  assert.equal(netWorthChange([]), null);
});
