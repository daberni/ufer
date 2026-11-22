import { test } from "node:test";
import assert from "node:assert/strict";
import { assignRules, categorizeEntries, type Rule } from "../src/features/categorization/server/rule-assignment";

function rule(fields: Partial<Rule> & Pick<Rule, "id" | "pattern" | "category_id">): Rule {
  return {
    name: fields.id,
    mode: "keyword",
    priority: 100,
    enabled: 1,
    transaction_type: null,
    transfer_account_id: null,
    ...fields
  };
}

const text = {
  account_id: "checking",
  counterparty: "City Market",
  description: "Card payment"
};

test("the enabled rule with the lowest priority, then the lowest ID, decides the assignment", () => {
  const rules = [
    rule({
      id: "b",
      pattern: "market",
      category_id: "groceries",
      priority: 10
    }),
    rule({
      id: "a",
      pattern: "card",
      category_id: "shopping",
      priority: 10
    }),
    rule({
      id: "0",
      pattern: "city",
      category_id: "travel",
      priority: 1,
      enabled: 0
    })
  ];

  assert.deepEqual(assignRules(rules, text), {
    categoryId: "shopping",
    ruleId: "a",
    type: null,
    transferAccountId: null
  });
});

test("rules match the overridden text as well as the source text", () => {
  const rules = [rule({
    id: "rent",
    pattern: "landlord",
    category_id: "housing"
  })];

  assert.equal(assignRules(rules, text).categoryId, null);
  assert.equal(assignRules(rules, {
    ...text,
    counterparty_override: "Landlord"
  }).categoryId, "housing");
  assert.equal(assignRules(rules, {
    ...text,
    counterparty: "Landlord",
    counterparty_override: "Someone else"
  }).categoryId, "housing");
});

test("a regex rule matches case-insensitively", () => {
  const rules = [rule({
    id: "regex",
    pattern: "^city\\s+market",
    mode: "regex",
    category_id: "groceries"
  })];

  assert.equal(assignRules(rules, text).ruleId, "regex");
});

test("a transfer rule carries its account, other typed rules do not", () => {
  const transfer = rule({
    id: "t",
    pattern: "market",
    category_id: "savings",
    transaction_type: "transfer",
    transfer_account_id: "savings-account"
  });
  const expense = rule({
    id: "e",
    pattern: "market",
    category_id: "groceries",
    transaction_type: "expense",
    transfer_account_id: "ignored"
  });

  assert.equal(assignRules([transfer], text).transferAccountId, "savings-account");
  assert.deepEqual(assignRules([expense], text), {
    categoryId: "groceries",
    ruleId: "e",
    type: "expense",
    transferAccountId: null
  });
});

test("entries record the type rule only when the deciding rule sets a type", () => {
  const rules = [
    rule({
      id: "typed",
      pattern: "salary",
      category_id: "income",
      transaction_type: "income"
    }),
    rule({
      id: "untyped",
      pattern: "market",
      category_id: "groceries"
    })
  ];
  const [salary, market, unmatched] = categorizeEntries([{
    ...text,
    counterparty: "Salary"
  }, text, {
    counterparty: "Unknown",
    description: ""
  }], rules, "checking");

  assert.deepEqual([salary.categoryRuleId, salary.ruleType, salary.typeRuleId], ["typed", "income", "typed"]);
  assert.deepEqual([market.categoryRuleId, market.ruleType, market.typeRuleId], ["untyped", null, null]);
  assert.deepEqual([unmatched.categoryId, unmatched.categoryRuleId, unmatched.typeRuleId], [null, null, null]);
});

test("a rule limited to an account decides only that account's bookings, so a later rule decides the others", () => {
  const rules = [
    rule({
      id: "savings-only",
      pattern: "market",
      category_id: "savings",
      priority: 1,
      account_id: "savings"
    }),
    rule({
      id: "everywhere",
      pattern: "market",
      category_id: "groceries",
      priority: 2
    })
  ];

  assert.equal(assignRules(rules, {
    ...text,
    account_id: "savings"
  }).ruleId, "savings-only");
  assert.equal(assignRules(rules, text).ruleId, "everywhere");
  assert.deepEqual(categorizeEntries([text], rules, "savings").map(entry => entry.categoryRuleId), ["savings-only"]);
});

test("a transfer rule naming the booking's own account sets a transfer to any account", () => {
  const rules = [rule({
    id: "move",
    pattern: "market",
    category_id: "savings",
    transaction_type: "transfer",
    transfer_account_id: "savings"
  })];

  assert.deepEqual(assignRules(rules, {
    ...text,
    account_id: "savings"
  }), {
    categoryId: "savings",
    ruleId: "move",
    type: "transfer",
    transferAccountId: null
  });
  assert.equal(assignRules(rules, text).transferAccountId, "savings");
});
