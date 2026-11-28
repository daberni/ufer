import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBankSelection, chosenBankName, defaultBankCountry, directoryBanks, namedCountries, type BankSelection } from "../src/features/banking/bank-selection";

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

test("a search keeps the chosen bank until another one is picked from the list", () => {
  const chosen = changeBankSelection(empty, {
    type: "choose",
    bankName: "Testbank Nord"
  });

  assert.equal(chosenBankName(chosen, directory), "Testbank Nord");

  const searched = changeBankSelection(chosen, {
    type: "search",
    query: "Alpine"
  });

  assert.equal(chosenBankName(searched, directory), "Testbank Nord");
  assert.equal(chosenBankName(changeBankSelection(searched, {
    type: "choose",
    bankName: "Alpine Savings Bank"
  }), directory), "Alpine Savings Bank");
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
    query: "",
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

test("the country defaults to existing connections, then the browser region, then the first offered country", () => {
  const offered = ["AT", "DE", "FI", "PT", "SE"];
  const connections = [{
    bank_country: "DE"
  }, {
    bank_country: "SE"
  }, {
    bank_country: "DE"
  }];

  assert.equal(defaultBankCountry(connections, ["en-GB"], offered), "DE");
  assert.equal(defaultBankCountry([], ["en-US", "fi-FI"], offered), "FI");
  assert.equal(defaultBankCountry([], ["pt-PT"], offered), "PT");
  assert.equal(defaultBankCountry([], ["sv-Latn-SE"], offered), "SE");
  assert.equal(defaultBankCountry([], ["en-US", "de"], offered), "AT");
});

test("a country the provider no longer offers is not a default, and nothing offered leaves no country", () => {
  assert.equal(defaultBankCountry([{
    bank_country: "GB"
  }], ["en-GB"], ["NL", "PT"]), "NL");
  assert.equal(defaultBankCountry([], ["de-AT"], []), null);
});

test("offered countries are named and sorted in the interface language", () => {
  assert.deepEqual(namedCountries(["SE", "DE", "AT"], "de").map(country => country.name), ["Deutschland", "Österreich", "Schweden"]);
  assert.deepEqual(namedCountries(["SE", "DE", "AT"], "en").map(country => country.name), ["Austria", "Germany", "Sweden"]);
});
