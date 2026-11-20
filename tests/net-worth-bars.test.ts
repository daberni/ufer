import assert from "node:assert/strict";
import { test } from "node:test";
import { netWorthBars } from "../src/features/reports/net-worth-bars";

test("the loan bar is drawn on the asset bar's scale", () => {
  const bars = netWorthBars({
    liquidity: 10_000,
    investments: 20_000,
    property: 70_000,
    liabilities: -25_000
  });

  assert.equal(bars.assets, 1);
  assert.equal(bars.loans, 0.25);
});

test("loans larger than the assets fill their bar and shorten the asset bar", () => {
  const bars = netWorthBars({
    liquidity: 5_000,
    investments: 0,
    property: 15_000,
    liabilities: -80_000
  });

  assert.equal(bars.loans, 1);
  assert.equal(bars.assets, 0.25);
});

test("negative cash stays out of both bars and a credit balance on a loan is no debt", () => {
  const bars = netWorthBars({
    liquidity: -3_000,
    investments: 6_000,
    property: 0,
    liabilities: 2_000
  });

  assert.deepEqual(bars, {
    segments: {
      cash: 0,
      investments: 6_000,
      property: 0
    },
    assets: 1,
    loans: 0
  });
});

test("without balances both bars are empty tracks", () => {
  assert.deepEqual(netWorthBars({
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0
  }), {
    segments: {
      cash: 0,
      investments: 0,
      property: 0
    },
    assets: 0,
    loans: 0
  });
});
