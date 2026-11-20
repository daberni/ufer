import assert from "node:assert/strict";
import { test } from "node:test";
import { draftEdits, draftState, initialDraft, type SplitDraft } from "../src/features/transactions/split-draft";

const expense = {
  amount_minor: -10000,
  currency: "EUR",
  split: null
};

function withAmounts(draft: SplitDraft, amounts: string[]): SplitDraft {
  return {
    ...draft,
    parts: amounts.map((amount, key) => ({
      key,
      amount,
      categoryId: draft.parts[key]?.categoryId ?? null,
      note: ""
    })),
    nextKey: amounts.length
  };
}

test("the remaining part keeps its chosen category while the entered parts cover the booking, and returns with it", () => {
  const draft = {
    ...withAmounts(initialDraft(expense, "groceries"), ["60"]),
    remainder: {
      categoryId: "leisure",
      note: "Gift"
    }
  };

  assert.deepEqual(draftEdits(draft, expense), [{
    amount: "-60.00",
    category_id: "groceries",
    note: ""
  }, {
    amount: "-40.00",
    category_id: "leisure",
    note: "Gift"
  }]);

  const covered = withAmounts(draft, ["60", "40"]);

  assert.equal(draftState(covered, expense).remaining, 0);
  assert.equal(draftEdits(covered, expense).length, 2);
  assert.equal(draftEdits(withAmounts(covered, ["60", "30"]), expense)[2]?.category_id, "leisure");
});

test("a draft is ready only with valid amounts that leave nothing over and make at least two parts", () => {
  const draft = initialDraft(expense, null);

  assert.equal(draftState(draft, expense).status, "single");
  assert.equal(draftState(withAmounts(draft, ["60", ""]), expense).status, "incomplete");
  assert.equal(draftState(withAmounts(draft, ["60", "abc"]), expense).status, "invalid");
  assert.equal(draftState(withAmounts(draft, ["60", "0"]), expense).status, "invalid");
  assert.equal(draftState(withAmounts(draft, ["60", "50"]), expense).status, "over");
  assert.equal(draftState(withAmounts(draft, ["60"]), expense).status, "ready");
  // A part going the other way is entered as a negative amount and widens what the others assign.
  assert.equal(draftState(withAmounts(draft, ["120", "-20"]), expense).status, "ready");
});
