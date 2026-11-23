import assert from "node:assert/strict";
import { test } from "node:test";
import { negotiateFormatLocale, negotiateLanguage } from "../src/server/http/accept-language";
import { browserDefaultLocale } from "../src/features/appearance/locale-options";
import { languageCookie, parseLanguagePreference } from "../src/lib/language";

test("the interface follows the first requested language with a catalog, otherwise English", () => {
  assert.equal(negotiateLanguage("browser", "de-AT,de;q=0.9,en;q=0.8"), "de");
  assert.equal(negotiateLanguage("browser", "fr-FR,de;q=0.7,en;q=0.5"), "de");
  assert.equal(negotiateLanguage("browser", "fr-FR,it"), "en");
  assert.equal(negotiateLanguage("browser", null), "en");
});

test("an explicitly chosen language wins over the browser's languages", () => {
  assert.equal(negotiateLanguage("en", "de-AT,de"), "en");
  assert.equal(negotiateLanguage("de", "en-US"), "de");
});

test("a stored language outside the catalogs follows the browser", () => {
  assert.equal(parseLanguagePreference("fr"), "browser");
  assert.equal(parseLanguagePreference(undefined), "browser");
  assert.equal(parseLanguagePreference("de"), "de");
  assert.match(languageCookie("browser", true), /^language=; Max-Age=0/);
});

test("with a chosen language the browser-default format stays in that language", () => {
  assert.equal(negotiateFormatLocale("browser", "en-US,de-AT;q=0.8", "de"), "de-AT");
  assert.equal(negotiateFormatLocale("browser", "en-US", "de"), "de");
  assert.equal(negotiateFormatLocale("browser", "de-AT,en-GB;q=0.5", "en"), "en-GB");
  // Without a chosen language and with an explicit format, nothing changes.
  assert.equal(negotiateFormatLocale("browser", "fr-FR,de;q=0.5"), "fr-FR");
  assert.equal(negotiateFormatLocale("en-US", "de-AT", "de"), "en-US");
});

test("the browser-default preview matches what the server selects for a chosen language", () => {
  assert.equal(browserDefaultLocale(["en-US", "de-AT"], "de"), "de-AT");
  assert.equal(browserDefaultLocale(["en-US"], "de"), "de");
  assert.equal(browserDefaultLocale(["en-US", "de-AT"]), "en-US");
});
