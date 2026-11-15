import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryTileColors, contrastRatio } from "../src/features/categorization/category-colors";

test("category icons keep a dark color unchanged and darken light colors until they stay visible on their tile", () => {
  assert.equal(categoryTileColors("#386B51").icon, "#386b51");

  for (const color of ["#ffffff", "#ffff00", "#f2f5ed", "#c2aa6b", "#a2aaa5", "#488a75", "#000000"]) {
    const colors = categoryTileColors(color);

    assert.ok(contrastRatio(colors.icon, colors.tile) >= 3, `${color} icon contrast`);
    assert.equal(colors.swatch, color);
  }

  assert.notEqual(categoryTileColors("#ffff00").icon, "#ffff00");
});
