import assert from "node:assert/strict";
import test from "node:test";
import { acceptedLanguages, defaultFormatLocale, formatCount, formatPercent, isNegativePercent, parseFormatLocalePreference, resolveFormatLocale } from "../src/lib/locale";
import { money, signedMoney } from "../src/lib/money";

// These cases use en-GB; CLDR separates a letter currency code from the number with a no-break space.
test("amounts use the application locale's standard currency format with the minus before the symbol", () => {
  assert.equal(money(123456, "EUR", "en-GB"), "€1,234.56");
  assert.equal(money(-123456, "EUR", "en-GB"), "-€1,234.56");
  assert.equal(money(-5, "USD", "en-GB"), "-US$0.05");
  assert.equal(money(-120050, "CHF", "en-GB"), "-CHF\u00a01,200.50");
});

test("zero and whole amounts keep the currency's minor digits", () => {
  assert.equal(money(0, "EUR", "en-GB"), "€0.00");
  assert.equal(money(100, "GBP", "en-GB"), "£1.00");
});

test("amounts follow each currency's minor units, including pinned ones", () => {
  assert.equal(money(1234, "JPY", "en-GB"), "JP¥1,234");
  assert.equal(money(-1234, "KWD", "en-GB"), "-KWD\u00a01.234");
  assert.equal(money(1250, "HUF", "en-GB"), "HUF\u00a012.50");
});

test("large amounts are grouped without losing cents", () => {
  assert.equal(money(123456789012, "EUR", "en-GB"), "€1,234,567,890.12");
  assert.equal(money(-900719925474099, "EUR", "en-GB"), "-€9,007,199,254,740.99");
});

test("signed amounts mark positives with a plus and leave zero unsigned", () => {
  assert.equal(signedMoney(1250, "EUR", "en-GB"), "+€12.50");
  assert.equal(signedMoney(-1250, "EUR", "en-GB"), "-€12.50");
  assert.equal(signedMoney(0, "EUR", "en-GB"), "€0.00");
});

test("percentages never show a negative zero", () => {
  assert.equal(formatPercent(0.183, "en-GB"), "18%");
  assert.equal(formatPercent(-0.25, "en-GB"), "-25%");
  assert.equal(formatPercent(-0.004, "en-GB"), "0%");
  assert.equal(isNegativePercent(-0.25, "en-GB"), true);
  assert.equal(isNegativePercent(-0.004, "en-GB"), false);
});

test("counts are grouped", () => {
  assert.equal(formatCount(1234567, "en-GB"), "1,234,567");
});

test("other locales place the symbol, separators and sign their own way", () => {
  assert.equal(money(-123456, "EUR", "de-AT"), "-€\u00a01.234,56");
  assert.equal(money(-123456, "EUR", "en-US"), "-€1,234.56");
  assert.equal(formatCount(1234567, "de-DE"), "1.234.567");
});

test("Accept-Language languages are ordered by quality, keeping header order for ties and dropping refused ones", () => {
  assert.deepEqual(acceptedLanguages("en-US;q=0.5, de-AT, fr;q=0, *;q=0.1, de;q=0.9"), ["de-AT", "de", "en-US"]);
  assert.deepEqual(acceptedLanguages(null), []);
});

test("the request's first language the runtime can format decides the locale", () => {
  assert.equal(resolveFormatLocale("browser", "de-AT,de;q=0.9,en;q=0.8"), "de-AT");
  assert.equal(resolveFormatLocale("browser", "en-US;q=0.4, de-AT;q=0.8"), "de-AT");
  assert.equal(resolveFormatLocale("browser", "not a tag, fr-FR;q=0.5"), "fr-FR");
});

test("a request without a usable language falls back to English", () => {
  assert.equal(defaultFormatLocale, "en");
  assert.equal(resolveFormatLocale("browser", null), "en");
  assert.equal(resolveFormatLocale("browser", "*"), "en");
  assert.equal(resolveFormatLocale("browser", "!!"), "en");
});

test("an explicit preference overrides the request's languages", () => {
  assert.equal(resolveFormatLocale("en-US", "de-AT"), "en-US");
  assert.equal(parseFormatLocalePreference("xx-unknown"), "browser");
  assert.equal(parseFormatLocalePreference(null), "browser");
});
