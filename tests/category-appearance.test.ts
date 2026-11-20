import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement, useState } from "react";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";
import { categoryGlyphColor, contrastRatio, parseHexColor, suggestedCategoryColors } from "../src/features/categorization/category-colors";
import { categoryIconKeys, isCategoryIcon, matchesCategoryIconSearch } from "../src/features/categorization/category-icons";
import { categoryIconComponents } from "../src/features/categorization/components/category-icon-components";

stubCssModules();

// jsdom has no popover API, so role queries treat the swatch popover's content as hidden.
function swatch(screen: RenderResult, name: string) {
  return screen.container.querySelector(`[role='radio'][aria-label='${name}']`);
}

// The dark --surface token in globals.css.
const darkSurface = "#19221d";

// Icon keys stored before the icon set grew; categories in existing databases still reference them.
const storedIconKeys = ["groceries", "dining", "transport", "housing", "utilities", "health", "shopping", "entertainment", "travel", "education", "gifts", "fees", "income", "savings", "transfer", "other", "coffee", "bar", "fuel", "transit", "insurance", "phone", "subscriptions", "furniture", "clothing", "pharmacy", "fitness", "hobbies", "pets", "childcare", "charity", "salary", "investments", "cash", "loan"];

test("a typed or pasted hex color is accepted with or without # in any letter case and normalized to uppercase #RRGGBB", () => {
  assert.equal(parseHexColor("#1d9e75"), "#1D9E75");
  assert.equal(parseHexColor("1D9E75"), "#1D9E75");
  assert.equal(parseHexColor("  #1d9E75\n"), "#1D9E75");
  assert.equal(parseHexColor("#abc"), "#AABBCC");
  assert.equal(parseHexColor("abc"), "#AABBCC");
});

test("anything other than a three or six digit hex color is rejected", () => {
  for (const input of ["", "#", "#12345", "#1234567", "12 34 56", "##123456", "#gggggg", "rgb(1, 2, 3)", "green", "#1d9e75ff"]) {
    assert.equal(parseHexColor(input), null, input);
  }
});

test("suggested colors are distinct normalized values that read as solid marks with a white glyph in both themes", () => {
  const values = suggestedCategoryColors.map(color => color.value);

  assert.equal(values.length, 16);
  assert.equal(new Set(values).size, values.length);
  assert.equal(new Set(suggestedCategoryColors.map(color => color.name)).size, values.length);

  for (const value of values) {
    assert.equal(parseHexColor(value), value);
    assert.ok(contrastRatio("#ffffff", value) >= 3, `${value} white glyph`);
    assert.ok(contrastRatio(darkSurface, value) >= 3, `${value} on the dark surface`);
    assert.equal(categoryGlyphColor(value, "light"), "#ffffff");
    assert.equal(categoryGlyphColor(value, "dark"), "#ffffff");
  }
});

test("a glyph on a light category color switches to dark text to stay visible", () => {
  assert.equal(categoryGlyphColor("#f2f5ed", "light"), "#243a30");
});

test("icon keys stored before the set grew stay valid and keep an icon", () => {
  for (const key of storedIconKeys) {
    assert.ok(isCategoryIcon(key), key);
    assert.ok(isCategoryIcon(key) && categoryIconComponents[key], key);
  }

  assert.ok(categoryIconKeys.length >= 100);
  assert.equal(isCategoryIcon("toString"), false);
  assert.equal(isCategoryIcon("unknown-icon"), false);
});

test("icon search matches every query word at the start of a word of the label, group or keywords, ignoring letter case", () => {
  assert.ok(matchesCategoryIconSearch("groceries", "SUPERMARKET"));
  assert.ok(matchesCategoryIconSearch("groceries", "super"));
  assert.ok(matchesCategoryIconSearch("fuel", "transport petrol"));
  assert.ok(matchesCategoryIconSearch("fuel", "trans pet"));
  assert.ok(matchesCategoryIconSearch("coffee", "Food"));
  assert.ok(matchesCategoryIconSearch("transport", "car"));
  assert.ok(matchesCategoryIconSearch("credit-card", "car"));
  assert.ok(matchesCategoryIconSearch("childcare", "kids"));
  assert.equal(matchesCategoryIconSearch("coffee", "petrol"), false);
  assert.equal(matchesCategoryIconSearch("fuel", "transport coffee"), false);
  // Matches inside a word do not count.
  assert.equal(matchesCategoryIconSearch("childcare", "car"), false);
  assert.equal(matchesCategoryIconSearch("credit-card", "ard"), false);
});

test("the color field applies a valid typed hex color, keeps the last color on invalid input, and its swatch popover closes on Escape without reaching the dialog", async context => {
  browser(context);

  const { CategoryColorField } = await import("../src/features/categorization/components/category-color-field");

  function Harness() {
    const [color, setColor] = useState("#638777");
    const [open, setOpen] = useState(false);

    return createElement("form", null, createElement(CategoryColorField, {
      color,
      onChange: setColor,
      open,
      onOpenChange: setOpen
    }));
  }

  const screen = render(createElement(Harness));
  const stored = () => (screen.container.querySelector("input[name='color']") as HTMLInputElement).value;
  const trigger = screen.getByRole("button", {
    name: "Suggested colors"
  });

  act(() => {
    fireEvent.click(trigger);
  });

  assert.equal(swatch(screen, "Sage")?.getAttribute("tabindex"), "0");

  const hex = screen.getByLabelText("Color") as HTMLInputElement;

  act(() => {
    fireEvent.change(hex, {
      target: {
        value: "zz12"
      }
    });
  });

  act(() => {
    fireEvent.focusOut(hex);
  });

  assert.equal(screen.getByRole("alert").textContent, "Enter a color like #1D9E75");
  assert.equal(stored(), "#638777");

  act(() => {
    fireEvent.change(hex, {
      target: {
        value: "1d9e75"
      }
    });
  });

  assert.equal(stored(), "#1D9E75");
  assert.equal(screen.queryByRole("alert"), null);
  assert.equal(swatch(screen, "Jade")?.getAttribute("aria-checked"), "true");

  let escape: KeyboardEvent | undefined;

  act(() => {
    escape = new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true
    });
    swatch(screen, "Jade")?.dispatchEvent(escape);
  });

  assert.equal(escape?.defaultPrevented, true);
  assert.equal(screen.container.querySelector("[role='radiogroup']"), null);
  assert.ok(document.activeElement === trigger);
});

test("an invalid hex text blocks submitting the category form until it is corrected", async context => {
  browser(context);

  const { CategoryColorField } = await import("../src/features/categorization/components/category-color-field");
  const screen = render(createElement("form", null, createElement(CategoryColorField, {
    color: "#638777",
    onChange: () => undefined,
    open: true,
    onOpenChange: () => undefined
  })));
  const form = screen.container.querySelector("form") as HTMLFormElement;
  const hex = screen.getByLabelText("Color") as HTMLInputElement;

  act(() => {
    fireEvent.change(hex, {
      target: {
        value: "#12"
      }
    });
  });

  let valid = true;

  act(() => {
    valid = form.checkValidity();
  });

  assert.equal(valid, false);
  assert.equal(screen.getByRole("alert").textContent, "Enter a color like #1D9E75");

  act(() => {
    fireEvent.change(hex, {
      target: {
        value: "#123"
      }
    });
  });

  assert.equal(form.checkValidity(), true);
});

test("icon search ignores letter case independent of a Turkish browser locale", context => {
  // In a Turkish locale, the locale-aware lowercase of I is a dotless ı, which would stop DINING from matching Dining.
  context.mock.method(String.prototype, "toLocaleLowerCase", function (this: string) {
    return this.replace(/I/g, "ı").toLowerCase();
  });

  assert.ok(matchesCategoryIconSearch("dining", "DINING"));
});
