import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "temporal-polyfill";
import { describeDate, describeMonth } from "../src/lib/date-format";
import { monthRangeLabel } from "../src/features/dashboard/presentation";
import { productTimeZone } from "../src/lib/time";

test("date-only values keep their calendar day and show no time or zone", () => {
  const display = describeDate(Temporal.PlainDate.from("2026-03-01"));

  assert.equal(display.dateTime, "2026-03-01");
  assert.equal(display.label, "1 Mar");
  assert.doesNotMatch(display.title, /\d{2}:\d{2}/);
  assert.match(display.title, /1 March 2026/);
});

test("timestamp titles name the timezone for a named zone", () => {
  const display = describeDate(Temporal.Instant.from("2026-03-01T23:30:00.000Z").toZonedDateTimeISO("Europe/Vienna"));

  assert.equal(display.dateTime, "2026-03-01T23:30:00Z");
  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /00:30:00 CET$/);
});

test("timestamp titles keep the offset for zones without an abbreviation", () => {
  const display = describeDate(Temporal.Instant.from("2026-03-01T23:30:00.000Z").toZonedDateTimeISO("Asia/Kolkata"));

  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /05:00:00 GMT\+5:30$/);
});

test("the product default zone yields a machine-independent timestamp", () => {
  const display = describeDate(Temporal.Instant.from("2026-03-01T23:30:00.000Z").toZonedDateTimeISO(productTimeZone));

  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /00:30:00 CET$/);
});

test("month names do not depend on the machine time zone", () => {
  assert.deepEqual(describeMonth(Temporal.PlainYearMonth.from("2026-03")), {
    label: "Mar",
    title: "March 2026"
  });
  assert.equal(monthRangeLabel(["2026-06", "2026-11"].map(month => Temporal.PlainYearMonth.from(month))), "Jun – Nov 2026");
  assert.equal(monthRangeLabel(["2025-12", "2026-05"].map(month => Temporal.PlainYearMonth.from(month))), "Dec 2025 – May 2026");
});
