import assert from "node:assert/strict";
import test from "node:test";
import { fallbackLocale, formatCount, formatPercent, isNegativePercent, formatLocale, parseFormatLocalePreference, resolveFormatLocale } from "../src/lib/locale";
import { money, signedMoney } from "../src/lib/money";

// The tests run like the server, with the fallback locale; CLDR separates a letter currency code from the number with a no-break space.
test("amounts use the application locale's standard currency format with the minus before the symbol", () => {
  assert.equal(money(123456, "EUR"), "€1,234.56");
  assert.equal(money(-123456, "EUR"), "-€1,234.56");
  assert.equal(money(-5, "USD"), "-US$0.05");
  assert.equal(money(-120050, "CHF"), "-CHF\u00a01,200.50");
});

test("zero and whole amounts keep the currency's minor digits", () => {
  assert.equal(money(0, "EUR"), "€0.00");
  assert.equal(money(100, "GBP"), "£1.00");
});

test("amounts follow each currency's minor units, including pinned ones", () => {
  assert.equal(money(1234, "JPY"), "JP¥1,234");
  assert.equal(money(-1234, "KWD"), "-KWD\u00a01.234");
  assert.equal(money(1250, "HUF"), "HUF\u00a012.50");
});

test("large amounts are grouped without losing cents", () => {
  assert.equal(money(123456789012, "EUR"), "€1,234,567,890.12");
  assert.equal(money(-900719925474099, "EUR"), "-€9,007,199,254,740.99");
});

test("signed amounts mark positives with a plus and leave zero unsigned", () => {
  assert.equal(signedMoney(1250, "EUR"), "+€12.50");
  assert.equal(signedMoney(-1250, "EUR"), "-€12.50");
  assert.equal(signedMoney(0, "EUR"), "€0.00");
});

test("percentages never show a negative zero", () => {
  assert.equal(formatPercent(0.183), "18%");
  assert.equal(formatPercent(-0.25), "-25%");
  assert.equal(formatPercent(-0.004), "0%");
  assert.equal(isNegativePercent(-0.25), true);
  assert.equal(isNegativePercent(-0.004), false);
});

test("counts are grouped", () => {
  assert.equal(formatCount(1234567), "1,234,567");
});

test("the browser's first supported language decides the format", () => {
  assert.equal(resolveFormatLocale("browser", ["de-AT", "en-GB"]), "de-AT");
  assert.equal(resolveFormatLocale("browser", ["not a tag", "fr-FR"]), "fr-FR");
  assert.equal(resolveFormatLocale("browser", []), fallbackLocale);
});

test("an explicit preference overrides the browser's languages", () => {
  assert.equal(resolveFormatLocale("en-US", ["de-AT"]), "en-US");
  assert.equal(parseFormatLocalePreference("xx-unknown"), "browser");
  assert.equal(parseFormatLocalePreference(null), "browser");
});

test("the server keeps formatting with the fallback locale", () => {
  assert.equal(formatLocale(), fallbackLocale);
});
