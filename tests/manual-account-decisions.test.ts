import assert from "node:assert/strict";
import { test } from "node:test";
import { decideClosing, decideManualBalance, decideReconciliation } from "../src/features/transactions/server/manual-account-decisions";

test("a balance for an account without bookings becomes its opening balance, even when it is 0", () => {
  assert.deepEqual(decideManualBalance({
    count: 0,
    onDate: 0
  }, 0), {
    type: "opening_balance",
    amount: 0
  });
});

test("a balance for an account with bookings adjusts by the difference to the bookings through its date", () => {
  assert.deepEqual(decideManualBalance({
    count: 3,
    onDate: 12_500
  }, 10_000), {
    type: "adjustment",
    amount: -2_500
  });
  assert.equal(decideManualBalance({
    count: 3,
    onDate: 10_000
  }, 10_000), null);
});

test("reconciliation needs a comparable reported booked balance and adjusts only a differing total", () => {
  const comparable = ["CLBD"];

  assert.equal(decideReconciliation(null, 0, comparable), "not_reported");
  assert.equal(decideReconciliation({
    amount: 100,
    type: null
  }, 0, comparable), "not_reported");
  assert.equal(decideReconciliation({
    amount: 100,
    type: "ITAV"
  }, 0, comparable), "not_reported");
  assert.equal(decideReconciliation({
    amount: 100,
    type: "CLBD"
  }, 100, comparable), "matches");
  assert.equal(decideReconciliation({
    amount: 100,
    type: "CLBD"
  }, 90, comparable), "adjust");
});

test("closing refuses a changed balance before a date that precedes the last booking", () => {
  assert.deepEqual(decideClosing({
    amount: 500,
    latest: "2026-03-10"
  }, 400, "2026-03-01", false), {
    refused: "balance_changed"
  });
  assert.deepEqual(decideClosing({
    amount: 500,
    latest: "2026-03-10"
  }, 500, "2026-03-09", false), {
    refused: "before_last_booking",
    lastBooking: "2026-03-10"
  });
});

test("closing books the remaining balance away as a transfer or an adjustment", () => {
  assert.deepEqual(decideClosing({
    amount: 500,
    latest: "2026-03-10"
  }, 500, "2026-03-10", true), {
    amount: -500,
    type: "transfer"
  });
  assert.deepEqual(decideClosing({
    amount: -200,
    latest: null
  }, -200, "2026-01-01", false), {
    amount: 200,
    type: "adjustment"
  });
});
