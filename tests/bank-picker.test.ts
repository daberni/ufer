import assert from "node:assert/strict";
import { test } from "node:test";
import { bankPickerKeyAction, matchingBanks, type BankPickerState } from "../src/features/banking/bank-picker-behavior";
import { changeBankSelection, chosenBankName, defaultBankCountry, type BankSelection } from "../src/features/banking/bank-selection";

const directory = [{
  name: "Alpine Savings Bank",
  country: "AT"
}, {
  name: "Österreichische Testbank",
  country: "AT"
}, {
  name: "First Mountain Bank",
  country: "AT",
  beta: true
}, {
  name: "Testbank Nord",
  country: "AT"
}];

const empty: BankSelection = {
  country: "AT",
  query: "",
  bankName: ""
};

test("a search that no longer shows the chosen bank clears it, so it cannot be authorized", () => {
  const chosen = changeBankSelection(empty, {
    type: "choose",
    bankName: "Testbank Nord"
  });

  assert.equal(chosenBankName(chosen, directory), "Testbank Nord");

  const searched = changeBankSelection(chosen, {
    type: "search",
    query: "Alpine"
  });

  assert.equal(chosenBankName(searched, directory), "");
});

test("changing the country clears the search and the chosen bank", () => {
  const chosen = changeBankSelection(empty, {
    type: "choose",
    bankName: "Testbank Nord"
  });

  assert.deepEqual(changeBankSelection(chosen, {
    type: "country",
    country: "DE"
  }), {
    country: "DE",
    query: "",
    bankName: ""
  });
});

test("a chosen bank missing from the loaded directory is not authorized", () => {
  const reauthorized: BankSelection = {
    country: "AT",
    query: "Retired Bank",
    bankName: "Retired Bank"
  };

  assert.equal(chosenBankName(reauthorized, directory), "");
  assert.equal(chosenBankName(reauthorized, []), "");
});

test("bank search ignores case and accents and needs every typed word", () => {
  assert.deepEqual(matchingBanks(directory, "osterreich").banks.map(bank => bank.name), ["Österreichische Testbank"]);
  assert.deepEqual(matchingBanks(directory, "BANK mountain").banks.map(bank => bank.name), ["First Mountain Bank"]);
  assert.equal(matchingBanks(directory, "credit union").total, 0);
});

test("bank search lists name prefixes first, then word prefixes, then other matches", () => {
  const banks = [{
    name: "Kreditbank",
    country: "DE"
  }, {
    name: "Bank of the North",
    country: "DE"
  }, {
    name: "Northern Bank",
    country: "DE"
  }, {
    name: "Alpha Bank",
    country: "DE"
  }];

  assert.deepEqual(matchingBanks(banks, "bank").banks.map(bank => bank.name), ["Bank of the North", "Alpha Bank", "Northern Bank", "Kreditbank"]);
});

test("a long directory is cut off at the limit, offers each name once and reports the full count", () => {
  const banks = Array.from({
    length: 250
  }, (_, index) => ({
    name: `Savings Bank ${String(index).padStart(3, "0")}`,
    country: "DE"
  }));

  const matches = matchingBanks([...banks, banks[0]], "", 100);

  assert.equal(matches.banks.length, 100);
  assert.equal(matches.total, 250);
  assert.equal(matches.banks[0].name, "Savings Bank 000");
});

test("the country defaults to existing connections, then the browser region, then Austria", () => {
  const connections = [{
    bank_country: "DE"
  }, {
    bank_country: "SE"
  }, {
    bank_country: "DE"
  }];

  assert.equal(defaultBankCountry(connections, ["en-GB"]), "DE");
  assert.equal(defaultBankCountry([], ["en-US", "fi-FI"]), "FI");
  assert.equal(defaultBankCountry([], ["sv-Latn-SE"]), "SE");
  assert.equal(defaultBankCountry([], ["en-US", "de"]), "AT");
});

const closed: BankPickerState = {
  open: false,
  activeIndex: -1,
  selectedIndex: -1,
  optionCount: 4
};

const open: BankPickerState = {
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

test("arrow keys open the list on the chosen bank, otherwise on the first or last bank", () => {
  assert.deepEqual(bankPickerKeyAction(key("ArrowDown"), closed), {
    type: "open",
    activeIndex: 0
  });
  assert.deepEqual(bankPickerKeyAction(key("ArrowUp"), closed), {
    type: "open",
    activeIndex: 3
  });
  assert.deepEqual(bankPickerKeyAction(key("ArrowUp"), {
    ...closed,
    selectedIndex: 2
  }), {
    type: "open",
    activeIndex: 2
  });
  assert.deepEqual(bankPickerKeyAction(key("ArrowDown", true), closed), {
    type: "open",
    activeIndex: -1
  });
});

test("keys that edit the text or belong to the form and dialog are left alone while the list is closed", () => {
  for (const name of ["Enter", "Escape", "Home", "End", "Tab", "a"]) {
    assert.deepEqual(bankPickerKeyAction(key(name), closed), {
      type: "none"
    }, name);
  }
});

test("an open list moves within its banks, picks with Enter and closes with Escape or Tab", () => {
  assert.deepEqual(bankPickerKeyAction(key("ArrowDown"), open), {
    type: "move",
    activeIndex: 2
  });
  assert.deepEqual(bankPickerKeyAction(key("PageDown"), open), {
    type: "move",
    activeIndex: 3
  });
  assert.deepEqual(bankPickerKeyAction(key("PageUp"), open), {
    type: "move",
    activeIndex: 0
  });
  assert.deepEqual(bankPickerKeyAction(key("Enter"), open), {
    type: "select"
  });

  for (const name of ["Escape", "Tab"]) {
    assert.deepEqual(bankPickerKeyAction(key(name), open), {
      type: "close"
    }, name);
  }

  assert.deepEqual(bankPickerKeyAction(key("Home"), open), {
    type: "none"
  });
});

test("Enter without a highlighted bank closes the list instead of submitting the form", () => {
  assert.deepEqual(bankPickerKeyAction(key("Enter"), {
    ...open,
    activeIndex: -1
  }), {
    type: "close"
  });
  assert.deepEqual(bankPickerKeyAction(key("Enter"), {
    ...open,
    activeIndex: -1,
    optionCount: 0
  }), {
    type: "close"
  });
});
