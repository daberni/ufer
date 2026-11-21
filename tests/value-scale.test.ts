import assert from "node:assert/strict";
import { test } from "node:test";
import { valueScale } from "../src/lib/value-scale";
import { plotBalances } from "../src/features/accounts/balance-chart";

const band = {
  top: 2,
  base: 32,
  flat: 32
};

test("a series crossing zero places the zero line exactly at value 0", () => {
  const scale = valueScale([-50_00, 10_00, 150_00], band);

  assert.equal(scale.zero, scale.y(0));
  assert.equal(scale.y(150_00), 2);
  assert.equal(scale.y(-50_00), 32);
  assert.equal(scale.zero, 2 + 150 / 200 * 30);
});

test("a series on one side of zero keeps its min–max scale and padded base without a zero line", () => {
  const positive = valueScale([100_00, 120_00, 140_00], band);
  const negative = valueScale([-140_00, -120_00, -100_00], band);

  assert.equal(positive.zero, null);
  assert.equal(positive.y(100_00), 32);
  assert.equal(positive.y(140_00), 2);
  assert.equal(negative.zero, null);
  assert.equal(negative.y(-140_00), 32);
  assert.equal(negative.y(-100_00), 2);
});

test("a series that only touches zero stays on one side", () => {
  assert.equal(valueScale([0, 50_00], band).zero, null);
  assert.equal(valueScale([-50_00, 0], band).zero, null);
});

test("the balance history's zero line meets a balance of exactly zero", () => {
  const chart = plotBalances([-100_00, 0, 100_00].map((amount, index) => ({
    date: `2026-01-0${index + 1}`,
    amount_minor: amount,
    source: "sync" as const,
    bank_balance_type: null
  })));

  assert.equal(chart.zero, chart.points[1].y);
  assert.ok(Math.abs(chart.points[1].y - 50) < 1e-9);
});
