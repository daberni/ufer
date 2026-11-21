import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "temporal-polyfill";
import { describeDate, describeMonth, formatYear, monthRangeLabel, shortMonthWithYear } from "../src/lib/date-format";
import { productTimeZone } from "../src/lib/time";

// CLDR separates month ranges with thin spaces around the en dash.

const yearReference = Temporal.Instant.from("2026-06-15T12:00:00Z");

test("date-only values keep their calendar day and show no time or zone", () => {
  const display = describeDate(Temporal.PlainDate.from("2026-03-01"), "en-GB", yearReference);

  assert.equal(display.dateTime, "2026-03-01");
  assert.equal(display.label, "1 Mar");
  assert.doesNotMatch(display.title, /\d{2}:\d{2}/);
  assert.match(display.title, /1 March 2026/);
});

test("timestamp titles name the timezone for a named zone", () => {
  const display = describeDate(Temporal.Instant.from("2026-03-01T23:30:00.000Z").toZonedDateTimeISO("Europe/Vienna"), "en-GB", yearReference);

  assert.equal(display.dateTime, "2026-03-01T23:30:00Z");
  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /00:30:00 CET$/);
});

test("timestamp titles keep the offset for zones without an abbreviation", () => {
  const display = describeDate(Temporal.Instant.from("2026-03-01T23:30:00.000Z").toZonedDateTimeISO("Asia/Kolkata"), "en-GB", yearReference);

  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /05:00:00 GMT\+5:30$/);
});

test("the product default zone yields a machine-independent timestamp", () => {
  const display = describeDate(Temporal.Instant.from("2026-03-01T23:30:00.000Z").toZonedDateTimeISO(productTimeZone), "en-GB", yearReference);

  assert.equal(display.label, "2 Mar");
  assert.match(display.title, /00:30:00 CET$/);
});

test("month names do not depend on the machine time zone", () => {
  assert.deepEqual(describeMonth(Temporal.PlainYearMonth.from("2026-03"), "en-GB"), {
    label: "Mar",
    title: "March 2026"
  });
  assert.equal(monthRangeLabel(["2026-06", "2026-11"].map(month => Temporal.PlainYearMonth.from(month)), "en-GB"), "Jun – Nov 2026");
  assert.equal(monthRangeLabel(["2025-12", "2026-05"].map(month => Temporal.PlainYearMonth.from(month)), "en-GB"), "Dec 2025 – May 2026");
});



test("calendar dates show a visible year for past and future years while the current year stays compact", () => {
  assert.equal(describeDate(Temporal.PlainDate.from("2025-12-31"), "en-GB", yearReference).label, "31 Dec 2025");
  assert.equal(describeDate(Temporal.PlainDate.from("2026-01-01"), "en-GB", yearReference).label, "1 Jan");
  assert.equal(describeDate(Temporal.PlainDate.from("2027-01-01"), "en-GB", yearReference).label, "1 Jan 2027");
});

test("current-year comparison follows the product calendar for days and the displayed zone for timestamps", () => {
  const newYearBoundary = Temporal.Instant.from("2027-01-01T00:30:00Z");
  const beforeViennaMidnight = Temporal.Instant.from("2026-12-31T22:30:00Z");
  const nextNewYorkMorning = Temporal.Instant.from("2027-01-01T06:00:00Z");

  assert.equal(describeDate(Temporal.PlainDate.from("2026-12-31"), "en-GB", newYearBoundary).label, "31 Dec 2026");
  assert.equal(describeDate(beforeViennaMidnight.toZonedDateTimeISO("Europe/Vienna"), "en-GB", newYearBoundary).label, "31 Dec 2026");
  assert.equal(describeDate(beforeViennaMidnight.toZonedDateTimeISO("America/New_York"), "en-GB", newYearBoundary).label, "31 Dec");
  assert.equal(describeDate(nextNewYorkMorning.toZonedDateTimeISO("America/New_York"), "en-GB", newYearBoundary).label, "1 Jan 2027");
});

test("months with their year follow the locale's order and punctuation instead of appending the ISO year", () => {
  const june = Temporal.PlainYearMonth.from("2026-06");
  const november = Temporal.PlainYearMonth.from("2026-11");
  const december = Temporal.PlainYearMonth.from("2025-12");

  assert.equal(shortMonthWithYear(december, "de-AT"), "Dez. 2025");
  assert.equal(shortMonthWithYear(december, "ja"), "2025年12月");
  assert.equal(monthRangeLabel([june, november], "de-AT"), "Juni–Nov. 2026");
  assert.equal(monthRangeLabel([december, june], "de-AT"), "Dez. 2025 – Juni 2026");
  assert.doesNotMatch(monthRangeLabel([december, june], "ja"), /12月 2025/);
});

test("years use the locale's numerals and style", () => {
  assert.equal(formatYear(2026, "en"), "2026");
  assert.equal(formatYear(2026, "ja"), "2026年");
  assert.equal(formatYear(2026, "ar-EG"), "٢٠٢٦");
});

test("dates are always Gregorian, also in locales with another default calendar, while numerals stay localized", () => {
  const sameYear = describeDate(Temporal.PlainDate.from("2026-03-01"), "fa-IR", yearReference);
  const otherYear = describeDate(Temporal.PlainDate.from("2025-12-31"), "fa-IR", yearReference);

  assert.doesNotMatch(sameYear.label, /[۰-۹]{4}/);
  assert.equal(sameYear.label, "۱ مارس");
  assert.match(otherYear.label, /۲۰۲۵/);
  assert.match(shortMonthWithYear(Temporal.PlainYearMonth.from("2025-12"), "fa-IR"), /۲۰۲۵/);
  assert.equal(formatYear(2026, "fa-IR"), "۲۰۲۶");
  assert.equal(formatYear(2026, "th-TH"), "2026");
});

test("years below 100 are not shifted into the 1900s", () => {
  assert.equal(formatYear(99, "en"), "99");
  assert.equal(shortMonthWithYear(Temporal.PlainYearMonth.from("0099-03"), "en"), "Mar 99");
  assert.equal(monthRangeLabel([Temporal.PlainYearMonth.from("0099-03"), Temporal.PlainYearMonth.from("0099-05")], "en"), "Mar – May 99");
});

test("month ranges use plain spaces so server and browser ICU versions render the same label", () => {
  const sameYear = ["2026-06", "2026-11"].map(month => Temporal.PlainYearMonth.from(month));
  const acrossYears = ["2025-12", "2026-05"].map(month => Temporal.PlainYearMonth.from(month));

  assert.equal(monthRangeLabel(sameYear, "en-US"), "Jun – Nov 2026");
  assert.equal(monthRangeLabel(acrossYears, "en-US"), "Dec 2025 – May 2026");
  assert.equal(monthRangeLabel(sameYear, "de-AT"), "Juni–Nov. 2026");
  assert.equal(monthRangeLabel(acrossYears, "de-AT"), "Dez. 2025 – Mai 2026");
});
