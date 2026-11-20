import assert from "node:assert/strict";
import { test } from "node:test";
import { draftEdits, draftState, initialDraft, nextPartAmount, type SplitDraft } from "../src/features/transactions/split-draft";

const expense = {
  amount_minor: -10000,
  currency: "EUR",
  split: null
};

function withAmounts(amounts: string[]): SplitDraft {
  return {
    parts: amounts.map((amount, key) => ({
      key,
      amount,
      categoryId: `category-${key}`,
      note: ""
    })),
    nextKey: amounts.length
  };
}

test("a draft is ready only when its valid amounts add up to the booking in at least two counted parts", () => {
  assert.equal(draftState(initialDraft(expense, null), expense).status, "single");
  assert.equal(draftState(withAmounts(["60"]), expense).status, "under");
  assert.equal(draftState(withAmounts(["60", "abc"]), expense).status, "invalid");
  assert.equal(draftState(withAmounts(["60", "50"]), expense).status, "over");
  assert.equal(draftState(withAmounts(["60", "40"]), expense).status, "ready");
  // A part going the other way is entered as a negative amount and widens what the others assign.
  assert.equal(draftState(withAmounts(["120", "-20"]), expense).status, "ready");
  // One counted part next to zero parts is a plain category, not a split.
  assert.equal(draftState(withAmounts(["100", "0", ""]), expense).status, "single");
});

test("parts with an amount of 0 raise no error and are not saved", () => {
  const draft = withAmounts(["60", "0", "40", ""]);

  assert.equal(draftState(draft, expense).status, "ready");
  assert.deepEqual(draftEdits(draft, expense), [{
    amount: "-60.00",
    category_id: "category-0",
    note: ""
  }, {
    amount: "-40.00",
    category_id: "category-2",
    note: ""
  }]);
});

test("a new part starts with what is still to assign, or 0 when nothing is", () => {
  assert.equal(nextPartAmount(draftState(withAmounts(["60"]), expense), "EUR"), "40.00");
  assert.equal(nextPartAmount(draftState(withAmounts(["100"]), expense), "EUR"), "0.00");
  assert.equal(nextPartAmount(draftState(withAmounts(["130"]), expense), "EUR"), "0.00");
});
