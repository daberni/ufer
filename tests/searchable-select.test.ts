import assert from "node:assert/strict";
import { test } from "node:test";
import { creatableName, matchOptions, searchableSelectKeyAction, type SearchableSelectState } from "../src/components/ui/searchable-select-behavior";

function labelled(...labels: string[]) {
  return labels.map(label => ({
    label
  }));
}

function labels(options: readonly {
  label: string;
}[]) {
  return options.map(option => option.label);
}

test("matching ignores case and accents and needs every typed word", () => {
  const options = labelled("Alpine Savings Bank", "Österreichische Testbank", "First Mountain Bank");

  assert.deepEqual(labels(matchOptions(options, "osterreich")), ["Österreichische Testbank"]);
  assert.deepEqual(labels(matchOptions(options, "BANK mountain")), ["First Mountain Bank"]);
  assert.deepEqual(matchOptions(options, "credit union"), []);
  assert.deepEqual(labels(matchOptions(options, "  ")), labels(options));
});

test("matching lists label prefixes first, then word prefixes, then other matches, each in the given order", () => {
  const options = labelled("Kreditbank", "Northern Bank", "Bank of the North", "Alpha Bank");

  assert.deepEqual(labels(matchOptions(options, "bank")), ["Bank of the North", "Northern Bank", "Alpha Bank", "Kreditbank"]);
});

const closed: SearchableSelectState = {
  open: false,
  activeIndex: -1,
  selectedIndex: -1,
  optionCount: 4
};

const open: SearchableSelectState = {
  ...closed,
  open: true,
  activeIndex: 1
};

function key(name: string, altKey = false) {
  return {
    key: name,
    altKey
  };
}

test("arrow keys open the list on the selected option, otherwise on the first or last option", () => {
  assert.deepEqual(searchableSelectKeyAction(key("ArrowDown"), closed), {
    type: "open",
    activeIndex: 0
  });
  assert.deepEqual(searchableSelectKeyAction(key("ArrowUp"), closed), {
    type: "open",
    activeIndex: 3
  });
  assert.deepEqual(searchableSelectKeyAction(key("ArrowUp"), {
    ...closed,
    selectedIndex: 2
  }), {
    type: "open",
    activeIndex: 2
  });
  assert.deepEqual(searchableSelectKeyAction(key("ArrowDown", true), closed), {
    type: "open",
    activeIndex: -1
  });
});

test("keys that edit the text or belong to the form and dialog are left alone while the list is closed", () => {
  for (const name of ["Enter", "Escape", "Home", "End", "Tab", "a"]) {
    assert.deepEqual(searchableSelectKeyAction(key(name), closed), {
      type: "none"
    }, name);
  }
});

test("an open list moves within its options, picks with Enter and closes with Escape or Tab", () => {
  assert.deepEqual(searchableSelectKeyAction(key("ArrowDown"), open), {
    type: "move",
    activeIndex: 2
  });
  assert.deepEqual(searchableSelectKeyAction(key("PageDown"), open), {
    type: "move",
    activeIndex: 3
  });
  assert.deepEqual(searchableSelectKeyAction(key("PageUp"), open), {
    type: "move",
    activeIndex: 0
  });
  assert.deepEqual(searchableSelectKeyAction(key("Enter"), open), {
    type: "select"
  });

  for (const name of ["Escape", "Tab"]) {
    assert.deepEqual(searchableSelectKeyAction(key(name), open), {
      type: "close"
    }, name);
  }

  assert.deepEqual(searchableSelectKeyAction(key("Home"), open), {
    type: "none"
  });
});

test("an open list without a highlighted option starts at its first option moving down and at its last moving up", () => {
  const unhighlighted = {
    ...open,
    activeIndex: -1
  };

  assert.deepEqual(searchableSelectKeyAction(key("ArrowDown"), unhighlighted), {
    type: "move",
    activeIndex: 0
  });
  assert.deepEqual(searchableSelectKeyAction(key("ArrowUp"), unhighlighted), {
    type: "move",
    activeIndex: 3
  });
});

test("Enter without a highlighted option closes the list instead of submitting the form", () => {
  assert.deepEqual(searchableSelectKeyAction(key("Enter"), {
    ...open,
    activeIndex: -1
  }), {
    type: "close"
  });
  assert.deepEqual(searchableSelectKeyAction(key("Enter"), {
    ...open,
    activeIndex: -1,
    optionCount: 0
  }), {
    type: "close"
  });
});

test("a create option is named after the trimmed search unless it is empty or an option already has that label in any case", () => {
  const options = labelled("Groceries", "Café");

  assert.equal(creatableName(options, "  Pets "), "Pets");
  assert.equal(creatableName(options, "Groc"), "Groc");
  assert.equal(creatableName(options, " GROCERIES "), "");
  assert.equal(creatableName(options, "CAFÉ"), "");
  assert.equal(creatableName(options, "   "), "");
});

test("search and create options fold case like the server's category names, whatever the browser's locale", context => {
  const lower = String.prototype.toLocaleLowerCase;

  // Emulates a Turkish default locale, where "I" folds to a dotless "ı".
  context.mock.method(String.prototype, "toLocaleLowerCase", function (this: string, locales?: Intl.LocalesArgument) {
    return lower.call(this, locales ?? "tr");
  });

  assert.equal(creatableName(labelled("I"), "i"), "");
  assert.deepEqual(matchOptions(labelled("I"), "i").map(option => option.label), ["I"]);
});
