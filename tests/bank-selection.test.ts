import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBankSelection, chosenBankName, defaultBankCountry, directoryBanks, type BankSelection } from "../src/features/banking/bank-selection";

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

test("the directory is offered alphabetically, with each bank name once", () => {
  const offered = directoryBanks([...directory, {
    name: "Alpine Savings Bank",
    country: "AT",
    beta: true
  }]);

  assert.deepEqual(offered.map(bank => bank.name), ["Alpine Savings Bank", "First Mountain Bank", "Österreichische Testbank", "Testbank Nord"]);
  assert.equal(offered[0].beta, undefined);
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
