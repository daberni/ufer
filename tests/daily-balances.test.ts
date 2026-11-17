import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyBalances } from "../src/features/accounts/daily-balances";

test("partial history uses the known balance rather than assuming the account opened at zero", () => {
  const balances = dailyBalances([
    {
      date: "2024-02-28",
      amount_minor: -500
    },
    {
      date: "2024-03-01",
      amount_minor: 200
    },
    {
      date: "2024-03-01",
      amount_minor: -100
    },
    {
      date: "2024-03-03",
      amount_minor: -50
    }
  ], {
    date: "2024-03-01",
    amount_minor: 10000,
    source: "sync"
  }, "2024-03-04");

  assert.deepEqual(balances.map(balance => [balance.date, balance.amount_minor]), [
    ["2024-02-28", 9900],
    ["2024-02-29", 9900],
    ["2024-03-01", 10000],
    ["2024-03-02", 10000],
    ["2024-03-03", 9950],
    ["2024-03-04", 9950]
  ]);
  assert.equal(balances[2].source, "sync");
  assert.equal(balances[1].source, "transactions");
});

test("a reference before the first booking is carried forward and future bookings do not alter closing balances", () => {
  const balances = dailyBalances([
    {
      date: "2026-01-03",
      amount_minor: -200
    },
    {
      date: "2026-01-10",
      amount_minor: 99900
    }
  ], {
    date: "2026-01-01",
    amount_minor: 1000,
    source: "manual"
  }, "2026-01-04");

  assert.deepEqual(balances.map(balance => balance.amount_minor), [1000, 1000, 800, 800]);
});
