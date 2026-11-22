import assert from "node:assert/strict";
import { test } from "node:test";
import { amountMinor, positionOn, priceOn, valueHolding, type PositionTrade } from "../src/features/securities/holdings";
import { ValidationError } from "../src/lib/errors";

const units = (value: number) => value * 1_000_000;

function buy(date: string, quantity: number, gross: number, fee = 0): PositionTrade {
  return {
    date,
    side: "buy",
    quantity_micros: units(quantity),
    gross_minor: gross,
    fee_minor: fee
  };
}

function sell(date: string, quantity: number, gross: number, fee = 0): PositionTrade {
  return {
    ...buy(date, quantity, gross, fee),
    side: "sell"
  };
}

test("buys accumulate quantity and a cost that includes their fees", () => {
  const position = positionOn([buy("2026-01-10", 10, 1000_00, 5_00), buy("2026-02-10", 5, 600_00, 3_00)], [], "2026-03-01");

  assert.deepEqual(position, {
    quantity_micros: units(15),
    cost_minor: 1608_00,
    realized_minor: 0
  });
});

test("a partial sale removes the moving-average cost and realizes proceeds less fees", () => {
  const trades = [buy("2026-01-10", 10, 1000_00, 5_00), buy("2026-02-10", 10, 1200_00, 5_00), sell("2026-03-10", 5, 700_00, 4_00)];

  // Average cost 2210.00 / 20 = 110.50; the sold 5 cost 552.50.
  assert.deepEqual(positionOn(trades, [], "2026-03-10"), {
    quantity_micros: units(15),
    cost_minor: 1657_50,
    realized_minor: 700_00 - 4_00 - 552_50
  });
});

test("selling everything leaves no quantity and no cost", () => {
  const position = positionOn([buy("2026-01-10", 3, 300_00, 1_00), sell("2026-02-10", 3, 270_00, 1_00)], [], "2026-02-10");

  assert.deepEqual(position, {
    quantity_micros: 0,
    cost_minor: 0,
    realized_minor: 270_00 - 1_00 - 301_00
  });
});

test("a position only includes trades up to the requested date", () => {
  const trades = [buy("2026-01-10", 10, 1000_00), sell("2026-03-10", 4, 500_00)];

  assert.equal(positionOn(trades, [], "2026-03-09").quantity_micros, units(10));
  assert.equal(positionOn(trades, [], "2026-01-09").quantity_micros, 0);
});

test("a split multiplies earlier quantities, keeps the cost and applies before trades on its date", () => {
  const trades = [buy("2026-01-10", 10, 1000_00), buy("2026-04-01", 2, 110_00)];
  const splits = [{
    date: "2026-04-01",
    numerator: 3,
    denominator: 1
  }];

  assert.equal(positionOn(trades, splits, "2026-03-31").quantity_micros, units(10));
  assert.deepEqual(positionOn(trades, splits, "2026-04-01"), {
    quantity_micros: units(32),
    cost_minor: 1110_00,
    realized_minor: 0
  });
});

test("a reverse split rounds fractional micro-units half to even", () => {
  const position = positionOn([{
    ...buy("2026-01-10", 0, 100_00),
    quantity_micros: 5
  }], [{
    date: "2026-02-01",
    numerator: 1,
    denominator: 2
  }], "2026-02-01");

  // 5 / 2 = 2.5 micro-units rounds to the even 2.
  assert.equal(position.quantity_micros, 2);
});

test("a sale beyond the held quantity is refused", () => {
  assert.throws(() => positionOn([buy("2026-01-10", 2, 200_00), sell("2026-01-11", 3, 300_00)], [], "2026-02-01"), ValidationError);
});

test("amounts multiply exact micro-units without floating-point error and respect the currency's decimals", () => {
  // 0.1 units at 0.3 would be 0.030000000000000002 in floating point.
  assert.equal(amountMinor(100_000, 300_000, "EUR"), 3);
  assert.equal(amountMinor(units(1234.567891), 98_765_432, "EUR"), 121932_63);
  assert.equal(amountMinor(units(3), 1_234_567, "JPY"), 4);
  assert.equal(amountMinor(units(1), 1_005_000, "EUR"), 1_00);
  assert.equal(amountMinor(units(1), 1_015_000, "EUR"), 1_02);
});

test("large holdings stay exact beyond the floating-point integer range of the intermediate product", () => {
  assert.equal(amountMinor(units(250_000), 1_234_567_890, "EUR"), 308641972_50);
});

test("the price on a date is the latest on or before it, never a later one", () => {
  const prices = [{
    date: "2026-03-02",
    close_micros: 101_000_000
  }, {
    date: "2026-03-04",
    close_micros: 104_000_000
  }];

  assert.equal(priceOn(prices, "2026-03-01"), null);
  assert.equal(priceOn(prices, "2026-03-03")?.close_micros, 101_000_000);
  assert.equal(priceOn(prices, "2026-03-04")?.close_micros, 104_000_000);
});

test("a holding without a price on or before the date is missing rather than worth zero", () => {
  const valuation = valueHolding(units(5), [{
    date: "2026-03-10",
    close_micros: 50_000_000
  }], "EUR", "2026-03-09");

  assert.deepEqual(valuation, {
    status: "missing",
    value_minor: null,
    price: null
  });
});

test("a price older than a week is used but marked stale", () => {
  const prices = [{
    date: "2026-03-02",
    close_micros: 50_000_000
  }];

  assert.equal(valueHolding(units(5), prices, "EUR", "2026-03-09").status, "current");
  assert.deepEqual(valueHolding(units(5), prices, "EUR", "2026-03-10"), {
    status: "stale",
    value_minor: 250_00,
    price: prices[0]
  });
});
