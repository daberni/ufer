import assert from "node:assert/strict";
import { test } from "node:test";
import { pickerKeyAction, popoverPlacement, typeaheadIndex, type PickerKey, type PickerState } from "../src/features/categorization/category-picker-behavior";

function key(name: string, modifiers: Partial<PickerKey> = {}): PickerKey {
  return {
    key: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...modifiers
  };
}

const closed: PickerState = {
  open: false,
  activeIndex: 0,
  selectedIndex: 3,
  optionCount: 6,
  typing: false
};

const open: PickerState = {
  ...closed,
  open: true,
  activeIndex: 3
};

test("a closed picker opens on the selected option, or on the first/last option for Home/End", () => {
  for (const name of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    assert.deepEqual(pickerKeyAction(key(name), closed), {
      type: "open",
      activeIndex: 3
    }, name);
  }

  assert.deepEqual(pickerKeyAction(key("ArrowDown"), {
    ...closed,
    selectedIndex: -1
  }), {
    type: "open",
    activeIndex: 0
  });
  assert.deepEqual(pickerKeyAction(key("Home"), closed), {
    type: "open",
    activeIndex: 0
  });
  assert.deepEqual(pickerKeyAction(key("End"), closed), {
    type: "open",
    activeIndex: 5
  });
  assert.deepEqual(pickerKeyAction(key("Tab"), closed), {
    type: "none"
  });
  assert.deepEqual(pickerKeyAction(key("Escape"), closed), {
    type: "none"
  });
});

test("an open picker moves within bounds and selects, closes or keeps typing", () => {
  const moves: [string, number][] = [["ArrowDown", 4], ["ArrowUp", 2], ["Home", 0], ["End", 5], ["PageDown", 5], ["PageUp", 0]];

  for (const [name, activeIndex] of moves) {
    assert.deepEqual(pickerKeyAction(key(name), open), {
      type: "move",
      activeIndex
    }, name);
  }

  assert.deepEqual(pickerKeyAction(key("ArrowDown"), {
    ...open,
    activeIndex: 5
  }), {
    type: "move",
    activeIndex: 5
  });
  assert.deepEqual(pickerKeyAction(key("Enter"), open), {
    type: "select"
  });
  assert.deepEqual(pickerKeyAction(key(" "), open), {
    type: "select"
  });
  assert.deepEqual(pickerKeyAction(key("ArrowUp", {
    altKey: true
  }), open), {
    type: "select"
  });
  assert.deepEqual(pickerKeyAction(key(" "), {
    ...open,
    typing: true
  }), {
    type: "typeahead",
    character: " "
  });
  assert.deepEqual(pickerKeyAction(key("Escape"), open), {
    type: "close"
  });
  assert.deepEqual(pickerKeyAction(key("Tab"), open), {
    type: "close"
  });
  assert.deepEqual(pickerKeyAction(key("g"), open), {
    type: "typeahead",
    character: "g"
  });
  assert.deepEqual(pickerKeyAction(key("c", {
    metaKey: true
  }), open), {
    type: "none"
  });
});

test("typeahead cycles through options sharing a first letter and refines with longer queries", () => {
  const labels = ["Uncategorized", "Gifts", "Groceries", "Health", "Gym", "Salary"];

  assert.equal(typeaheadIndex(labels, "g", 0), 1);
  assert.equal(typeaheadIndex(labels, "gg", 1), 2);
  assert.equal(typeaheadIndex(labels, "ggg", 2), 4);
  assert.equal(typeaheadIndex(labels, "gggg", 4), 1);
  assert.equal(typeaheadIndex(labels, "gr", 1), 2);
  assert.equal(typeaheadIndex(labels, "GY", 1), 4);
  assert.equal(typeaheadIndex(labels, "s", 5), 5);
  assert.equal(typeaheadIndex(labels, "x", 0), -1);
});

test("the popover opens below, flips above near the viewport bottom and stays inside narrow viewports", () => {
  const viewport = {
    width: 375,
    height: 800
  };
  const popover = {
    width: 240,
    height: 300
  };

  assert.deepEqual(popoverPlacement({
    top: 100,
    bottom: 130,
    left: 40
  }, popover, viewport), {
    top: 136,
    left: 40,
    maxHeight: 648
  });
  assert.deepEqual(popoverPlacement({
    top: 700,
    bottom: 730,
    left: 300
  }, popover, viewport), {
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
  }, viewport), {
    top: 136,
    left: 16,
    maxHeight: 648
  });
});
