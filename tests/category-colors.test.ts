import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryBarColor, categoryChipColors, categoryTileColors, contrastRatio, neutralChipColor, themedColors, type ColorScheme } from "../src/features/categorization/category-colors";

const schemes: ColorScheme[] = ["light", "dark"];

// The dark --surface token in globals.css.
const darkSurface = "#19221d";

test("category icons keep a readable stored color unchanged and adjust others until they stay visible on their tile", () => {
  assert.equal(categoryTileColors("#386B51", "light").icon, "#386b51");
  assert.equal(categoryTileColors("#d0708f", "dark").icon, "#d0708f");

  for (const scheme of schemes) {
    for (const color of ["#ffffff", "#ffff00", "#f2f5ed", "#c2aa6b", "#a2aaa5", "#488a75", "#233e31", "#000000"]) {
      const colors = categoryTileColors(color, scheme);

      assert.ok(contrastRatio(colors.icon, colors.tile) >= 3, `${scheme} ${color} icon contrast`);
    }
  }

  assert.notEqual(categoryTileColors("#ffff00", "light").icon, "#ffff00");
  assert.notEqual(categoryTileColors("#000000", "dark").icon, "#000000");
});

test("category chip names keep 4.5:1 contrast on their tint in both themes for light, mid-tone, dark and neutral colors", () => {
  const colors = [neutralChipColor, "#638777", "#386b51", "#488a75", "#c2aa6b", "#8e82b3", "#ffffff", "#ffff00", "#f2f5ed", "#a2aaa5", "#00ff88", "#000000", "#123456", "not-a-color"];

  for (const scheme of schemes) {
    for (const color of colors) {
      const chip = categoryChipColors(color, scheme);

      assert.ok(contrastRatio(chip.foreground, chip.background) >= 4.5, `${scheme} ${color} text contrast`);
    }
  }

  assert.equal(categoryChipColors("#386b51", "light").foreground, "#386b51");
  assert.notEqual(categoryChipColors("#c2aa6b", "light").foreground, "#c2aa6b");
  assert.notEqual(categoryChipColors("#386b51", "dark").foreground, "#386b51");
});

test("category bars show the stored color on light panels and lighten only dark colors on dark panels", () => {
  for (const color of ["#233e31", "#000000", "#cdd3c7", "#ffff00"]) {
    assert.equal(categoryBarColor(color, "light"), color);
  }

  for (const color of ["#233e31", "#000000", "#123456", "#3f87b5"]) {
    assert.ok(contrastRatio(categoryBarColor(color, "dark"), darkSurface) >= 3, `${color} bar contrast`);
  }

  assert.equal(categoryBarColor("#cdd3c7", "dark"), "#cdd3c7");
  assert.notEqual(categoryBarColor("#233e31", "dark"), "#233e31");
});

test("themed category colors pair each light value with its dark counterpart", () => {
  const light = categoryChipColors("#c0605f", "light");
  const dark = categoryChipColors("#c0605f", "dark");
  const themed = themedColors(scheme => categoryChipColors("#c0605f", scheme));

  assert.equal(themed.foreground, `light-dark(${light.foreground}, ${dark.foreground})`);
  assert.equal(themed.background, `light-dark(${light.background}, ${dark.background})`);
});
