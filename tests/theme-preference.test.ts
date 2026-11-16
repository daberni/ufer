import assert from "node:assert/strict";
import { test } from "node:test";
import { parseThemePreference, themeAttribute, themeCookie, themeCookieName, themeViewport } from "../src/features/appearance/theme-preference";

test("a missing or unknown stored theme follows the operating system instead of forcing a theme", () => {
  for (const value of [undefined, "", "system", "Dark", "dark mode", "<script>"]) {
    const preference = parseThemePreference(value);

    assert.equal(preference, "system", String(value));
    assert.equal(themeAttribute(preference), undefined);
  }

  assert.equal(themeAttribute(parseThemePreference("dark")), "dark");
  assert.equal(themeAttribute(parseThemePreference("light")), "light");
});

test("a manual theme is stored for the whole site and choosing System deletes it", () => {
  const dark = themeCookie("dark", true);

  assert.match(dark, new RegExp(`^${themeCookieName}=dark; `));
  assert.match(dark, /; Path=\/(;|$)/);
  assert.match(dark, /; Max-Age=[1-9]\d*(;|$)/);
  assert.match(dark, /; Secure(;|$)/);
  assert.doesNotMatch(themeCookie("light", false), /Secure/);

  const system = themeCookie("system", false);

  assert.match(system, new RegExp(`^${themeCookieName}=; `));
  assert.match(system, /; Max-Age=0(;|$)/);
  assert.match(system, /; Path=\/(;|$)/);
});

test("the document's color-scheme follows the operating system only without a manual theme", () => {
  assert.equal(themeViewport("system").colorScheme, "light dark");
  assert.equal(themeViewport("dark").colorScheme, "dark");
  assert.equal(themeViewport("light").colorScheme, "light");
});
