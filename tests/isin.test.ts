import assert from "node:assert/strict";
import { test } from "node:test";
import { findIsin, validIsin } from "../src/features/securities/isin";

test("ISINs are valid only with a matching check digit", () => {
  // Publicly documented ISINs of well-known instruments, used here only as check-digit examples.
  for (const code of ["US0378331005", "IE00B4L5Y983", "DE0005557508", "AU0000XVGZA3"]) {
    assert.equal(validIsin(code), true, code);
  }

  for (const code of ["US0378331006", "IE00B4L5Y98", "us0378331005", "XX00000000000"]) {
    assert.equal(validIsin(code), false, code);
  }
});

test("the ISIN is found in a booking text and look-alikes with a wrong check digit are skipped", () => {
  assert.equal(findIsin("Kauf Wertpapier IE00B4L5Y983 iShares Core MSCI World"), "IE00B4L5Y983");
  assert.equal(findIsin("Ref AT000000000123 / ISIN ie00b4l5y983"), "IE00B4L5Y983");
  assert.equal(findIsin("Order US0378331006 rejected"), null);
  assert.equal(findIsin("Card payment supermarket"), null);
});
