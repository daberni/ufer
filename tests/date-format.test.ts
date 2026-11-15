import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTimeZone, describeDate, parseDisplayDate } from "../src/lib/date-format";

test("date-only values keep their calendar day and show no time or zone", () => {
  const display = describeDate(parseDisplayDate("2026-03-01", "Pacific/Honolulu"));

  assert.equal(display.dateTime, "2026-03-01");
  assert.equal(display.label, "1 Mar");
  assert.doesNotMatch(display.title, /\d{2}:\d{2}/);
  assert.match(display.title, /1 March 2026/);
});

test("timestamp titles name the timezone for a named zone", () => {
  const display = describeDate(parseDisplayDate("2026-03-01T23:30:00.000Z", "Europe/Vienna"));

  assert.equal(display.dateTime, "2026-03-01T23:30:00Z");
  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /00:30:00 CET$/);
});

test("timestamp titles keep the offset for zones without an abbreviation", () => {
  const display = describeDate(parseDisplayDate("2026-03-01T23:30:00.000Z", "Asia/Kolkata"));

  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /05:00:00 GMT\+5:30$/);
});

test("the product default zone yields a machine-independent timestamp", () => {
  const display = describeDate(parseDisplayDate("2026-03-01T23:30:00.000Z", defaultTimeZone));

  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /00:30:00 CET$/);
});
