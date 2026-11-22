import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseListing } from "../src/features/securities/listing-choice";

const listing = (symbol: string, exchange: string, currency: string) => ({
  symbol,
  exchange,
  currency
});

test("the price listing prefers the account currency, then XETRA and other liquid venues", () => {
  const listings = [listing("SYN.LSE", "LSE", "GBP"), listing("SYN.F", "F", "EUR"), listing("SYN.XETRA", "XETRA", "EUR"), listing("SYN.US", "US", "USD")];

  assert.equal(chooseListing(listings, "EUR")?.symbol, "SYN.XETRA");
  assert.equal(chooseListing(listings.filter(item => item.exchange !== "XETRA"), "EUR")?.symbol, "SYN.F");
  assert.equal(chooseListing([listing("SYNF.EUFUND", "EUFUND", "EUR")], "EUR")?.symbol, "SYNF.EUFUND");
  assert.equal(chooseListing(listings, "USD")?.symbol, "SYN.US");
});

test("without a listing in the account currency the security has no price source", () => {
  assert.equal(chooseListing([listing("SYN.US", "US", "USD")], "EUR"), null);
  assert.equal(chooseListing([], "EUR"), null);
});
