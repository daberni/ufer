import assert from "node:assert/strict";
import { test } from "node:test";
import { amountMinor, averageCostMicros, positionOn, priceOn, saleGains, valueHolding, type PositionTrade } from "../src/features/securities/holdings";
import { ValidationError } from "../src/lib/errors";

const units = (value: number) => value * 1_000_000;

let nextSequence = 1;

function buy(date: string, quantity: number, gross: number, fee = 0): PositionTrade {
  return {
    date,
    side: "buy",
    sequence: nextSequence++,
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

function shuffled<Item>(items: Item[]) {
  return items.toReversed();
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

test("each sale realizes its own gain against the cost left after earlier trades and splits, adding up to the position's total", () => {
  const first = sell("2026-03-01", 4, 520_00, 2_00);
  const second = sell("2026-06-01", 6, 300_00, 1_00);
  const trades = [buy("2026-01-10", 10, 1000_00), buy("2026-02-10", 10, 1200_00), first, second];
  const splits = [{
    date: "2026-05-01",
    numerator: 2,
    denominator: 1
  }];
  const gains = saleGains(shuffled(trades), splits);

  // 20 shares cost 2,200.00; selling 4 removes 440.00. After the 2:1 split 32 shares cost 1,760.00; selling 6 removes 330.00.
  assert.equal(gains.get(first), 520_00 - 2_00 - 440_00);
  assert.equal(gains.get(second), 300_00 - 1_00 - 330_00);
  assert.equal(gains.size, 2);
  assert.equal(gains.get(first)! + gains.get(second)!, positionOn(trades, splits, "2026-12-31").realized_minor);
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

test("same-day trades replay in their recorded sequence whatever order they arrive in", () => {
  const trades = [buy("2026-01-10", 10, 1000_00), sell("2026-02-10", 10, 1100_00), buy("2026-02-10", 10, 1300_00)];
  const expected = {
    quantity_micros: units(10),
    cost_minor: 1300_00,
    realized_minor: 100_00
  };

  assert.deepEqual(positionOn(trades, [], "2026-02-10"), expected);
  assert.deepEqual(positionOn(shuffled(trades), [], "2026-02-10"), expected);
});

test("a same-day sale recorded before the buy that would cover it is refused regardless of input order", () => {
  const trades = [sell("2026-01-10", 5, 500_00), buy("2026-01-10", 5, 500_00)];

  assert.throws(() => positionOn(trades, [], "2026-01-10"), ValidationError);
  assert.throws(() => positionOn(shuffled(trades), [], "2026-01-10"), ValidationError);
});

test("a fully sold holding is worth exactly zero and current, even with an old price", () => {
  assert.deepEqual(valueHolding(0, [{
    date: "2026-01-02",
    close_micros: 50_000_000
  }], "EUR", "2026-06-30"), {
    status: "current",
    value_minor: 0,
    price: null
  });
});

test("the average cost per unit is exact in micro-units, also for large cost bases", () => {
  assert.equal(averageCostMicros(10_00, 3_000_000, "EUR"), 3_333_333);
  assert.equal(averageCostMicros(900_000_000_01, 123_456_789, "EUR"), 7_290_000_066_420);
  assert.equal(averageCostMicros(1_000, 3_000_000, "JPY"), 333_333_333);
});
