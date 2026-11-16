import assert from "node:assert/strict";
import { test } from "node:test";
import { popoverPlacement } from "../src/components/ui/popover-placement";

const phone = {
  top: 0,
  left: 0,
  width: 375,
  height: 800
};

const popover = {
  width: 240,
  height: 300
};

test("the popover opens below, flips above near the bottom and stays inside narrow viewports", () => {
  assert.deepEqual(popoverPlacement({
    top: 100,
    bottom: 130,
    left: 40
  }, popover, phone), {
    top: 136,
    left: 40,
    maxHeight: 648
  });
  assert.deepEqual(popoverPlacement({
    top: 700,
    bottom: 730,
    left: 300
  }, popover, phone), {
    top: 394,
    left: 119,
    maxHeight: 678
  });
  assert.deepEqual(popoverPlacement({
    top: 100,
    bottom: 130,
    left: 2
  }, {
    width: 400,
    height: 300
  }, phone), {
    top: 136,
    left: 16,
    maxHeight: 648
  });
});

test("an on-screen keyboard shrinks the visible area, so a field above it opens its list upwards within what is visible", () => {
  // The keyboard covers everything below 450 px.
  const withKeyboard = {
    top: 0,
    left: 0,
    width: 375,
    height: 450
  };
  const field = {
    top: 300,
    bottom: 348,
    left: 20
  };

  assert.deepEqual(popoverPlacement(field, popover, withKeyboard), {
    top: 16,
    left: 20,
    maxHeight: 278
  });
  // Measured against the whole window, the list would open below the field, behind the keyboard.
  assert.equal(popoverPlacement(field, popover, phone).top, 354);
});

test("a scrolled visual viewport, such as after zooming in, offsets the visible area", () => {
  assert.deepEqual(popoverPlacement({
    top: 500,
    bottom: 530,
    left: 20
  }, popover, {
    top: 450,
    left: 100,
    width: 300,
    height: 450
  }), {
    top: 536,
    left: 116,
    maxHeight: 348
  });
});
