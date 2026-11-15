import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDate } from "../src/lib/date-format";

test("date-only values keep their calendar day and show no time or zone", () => {
  const display = describeDate("2026-03-01");

  assert.equal(display.dateTime, "2026-03-01");
  assert.equal(display.label, "1 Mar");
  assert.doesNotMatch(display.title, /\d{2}:\d{2}/);
  assert.match(display.title, /1 March 2026/);
});

test("timestamps expose the time and timezone in the title", () => {
  const display = describeDate("2026-03-01T23:30:00.000Z");

  assert.equal(display.dateTime, "2026-03-01T23:30:00.000Z");
  assert.match(display.title, /\d{2}:\d{2}:\d{2}/);
  assert.match(display.title, /(GMT|UTC|[A-Z]{3,5})$/);
});
