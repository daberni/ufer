import assert from "node:assert/strict";
import { test } from "node:test";
import { tabRootEntry, type TabHistoryEntry } from "../src/client/tab-navigation";

function entries(...sameDocument: boolean[]): TabHistoryEntry[] {
  return sameDocument.map((same, index) => ({
    key: `k${index}`,
    index,
    sameDocument: same
  }));
}

test("a tab returns to the oldest entry of the app document before replacing it", () => {
  assert.equal(tabRootEntry(entries(true, true, true), 2)?.key, "k0");
});

test("a tab at the root replaces the current entry directly", () => {
  assert.equal(tabRootEntry(entries(true, true), 0), null);
});

test("the root stops at the first entry of another document, such as the sign-in page", () => {
  assert.equal(tabRootEntry(entries(false, true, true, true), 3)?.key, "k1");
});

test("forward entries never become the root", () => {
  assert.equal(tabRootEntry(entries(true, true, true, true), 1)?.key, "k0");
});

test("a gap in the reachable entries ends the root search", () => {
  const reachable = entries(true, true, true, true).filter(entry => entry.index !== 1);

  assert.equal(tabRootEntry(reachable, 3)?.key, "k2");
});
