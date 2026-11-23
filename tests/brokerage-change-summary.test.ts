import assert from "node:assert/strict";
import { test } from "node:test";
import { changeSummary, type HoldingInputs } from "../src/features/securities/valuation";

const units = (value: number) => value * 1_000_000;

function holding(id: string, trades: HoldingInputs["trades"], prices: [string, number][]): HoldingInputs {
  return {
    security_id: id,
    security_name: id,
    currency: "EUR",
    trades,
    splits: [],
    prices: prices.map(([date, close]) => ({
      date,
      close_micros: units(close)
    }))
  };
}

const buy = (date: string, quantity: number, gross: number, sequence = 1) => ({
  date,
  side: "buy" as const,
  sequence,
  quantity_micros: units(quantity),
  gross_minor: gross,
  fee_minor: 0
});

test("the total change adds unrealized and realized gains over all buy costs", () => {
  const traded = holding("a", [buy("2026-11-02", 10, 1000_00), {
    ...buy("2026-11-10", 5, 600_00, 2),
    side: "sell"
  }], [["2026-11-19", 110], ["2026-11-20", 120]]);
  const summary = changeSummary([traded], "2026-11-23");

  // Realized 600.00 − 500.00; unrealized 5 × 120.00 − 500.00.
  assert.equal(summary.total.gain_minor, 100_00 + 100_00);
  assert.equal(summary.total.ratio, 200_00 / 1000_00);
  assert.deepEqual(summary.day, {
    change_minor: 5 * 10_00,
    ratio: 50_00 / 550_00,
    date: "2026-11-20",
    previous_date: "2026-11-19",
    mixed_dates: false,
    excluded: 0
  });
});

test("stale, unpriced and single-price holdings are left out of the day change and reported, never counted as zero", () => {
  const current = holding("current", [buy("2026-11-02", 1, 100_00)], [["2026-11-19", 100], ["2026-11-20", 102]]);
  const stale = holding("stale", [buy("2026-09-01", 1, 100_00)], [["2026-09-01", 100], ["2026-09-02", 90]]);
  const unpriced = holding("unpriced", [buy("2026-11-02", 1, 100_00)], []);
  const single = holding("single", [buy("2026-11-02", 1, 100_00)], [["2026-11-20", 105]]);

  const mixed = changeSummary([current, stale, unpriced, single], "2026-11-23");

  assert.equal(mixed.day?.change_minor, 2_00);
  assert.equal(mixed.day?.excluded, 3);
  assert.equal(mixed.total.unpriced, 1);
  // The unpriced holding adds nothing; the others add 2.00, −10.00 and 5.00.
  assert.equal(mixed.total.gain_minor, 2_00 - 10_00 + 5_00);
  assert.equal(changeSummary([stale, unpriced, single], "2026-11-23").day, null);
});

test("a split between the last two prices is no change, and holdings priced on different dates are flagged", () => {
  const split = {
    ...holding("split", [buy("2026-11-02", 10, 1000_00)], [["2026-11-19", 100], ["2026-11-20", 50]]),
    splits: [{
      date: "2026-11-20",
      numerator: 2,
      denominator: 1
    }]
  };
  const fund = holding("fund", [buy("2026-11-02", 1, 100_00)], [["2026-11-18", 100], ["2026-11-19", 101]]);

  assert.equal(changeSummary([split], "2026-11-23").day?.change_minor, 0);

  const mixed = changeSummary([split, fund], "2026-11-23").day;

  assert.equal(mixed?.change_minor, 1_00);
  assert.equal(mixed?.mixed_dates, true);
});

test("a split newer than the latest price values today's quantity in that price's pre-split units", () => {
  const split = {
    ...holding("split", [buy("2026-11-02", 10, 1000_00)], [["2026-11-19", 100], ["2026-11-20", 110]]),
    splits: [{
      date: "2026-11-23",
      numerator: 2,
      denominator: 1
    }]
  };
  const summary = changeSummary([split], "2026-11-23");

  assert.equal(summary.total.gain_minor, 100_00);
  assert.equal(summary.day?.change_minor, 100_00);
});
