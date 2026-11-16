import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryChipColors, categoryTileColors, contrastRatio, neutralChipColor } from "../src/features/categorization/category-colors";

test("category icons keep a dark color unchanged and darken light colors until they stay visible on their tile", () => {
  assert.equal(categoryTileColors("#386B51").icon, "#386b51");

  for (const color of ["#ffffff", "#ffff00", "#f2f5ed", "#c2aa6b", "#a2aaa5", "#488a75", "#000000"]) {
    const colors = categoryTileColors(color);

    assert.ok(contrastRatio(colors.icon, colors.tile) >= 3, `${color} icon contrast`);
    assert.equal(colors.swatch, color);
  }

  assert.notEqual(categoryTileColors("#ffff00").icon, "#ffff00");
});

test("category chip names keep 4.5:1 contrast on their tint for light, mid-tone, dark and neutral colors", () => {
  const colors = [neutralChipColor, "#638777", "#386b51", "#488a75", "#c2aa6b", "#8e82b3", "#ffffff", "#ffff00", "#f2f5ed", "#a2aaa5", "#00ff88", "#000000", "#123456", "not-a-color"];

  for (const color of colors) {
    const chip = categoryChipColors(color);

    assert.ok(contrastRatio(chip.foreground, chip.background) >= 4.5, `${color} text contrast`);
  }

  assert.equal(categoryChipColors("#386b51").foreground, "#386b51");
  assert.notEqual(categoryChipColors("#c2aa6b").foreground, "#c2aa6b");
});

