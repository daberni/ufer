import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRules, type Rule } from "../src/features/categorization/server/rule-assignment";
import { decideAdoptedTypes, decideRuleCategoryChanges, decideRuleTypeChanges, decidedByStoredRule } from "../src/features/categorization/server/rule-decisions";

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

function booking(id: string, counterparty: string) {
  return {
    id,
    account_id: "checking",
    counterparty,
    description: ""
  };
}

test("a stored rule selects only the bookings it decides, not those an earlier rule wins", () => {
  const rules = [rule({
    id: "early",
    pattern: "market",
    category_id: "leisure",
    priority: 10
  }), rule({
    id: "late",
    pattern: "city",
    category_id: "groceries",
    priority: 20
  })];

  assert.deepEqual(decidedByStoredRule("late")(rules, [booking("market", "City Market"), booking("hall", "City Hall")]), ["hall"]);
});

test("re-applying reports a changed category as recategorized and a changed rule reference alone as not", () => {
  const rules = prepareRules([rule({
    id: "groceries-rule",
    pattern: "market",
    category_id: "groceries"
  })]);
  const changes = decideRuleCategoryChanges([{
    ...booking("moved", "Market"),
    category_id: "leisure",
    category_rule_id: "old"
  }, {
    ...booking("attributed", "Market"),
    category_id: "groceries",
    category_rule_id: null
  }, {
    ...booking("unchanged", "Market"),
    category_id: "groceries",
    category_rule_id: "groceries-rule"
  }], rules);

  assert.deepEqual(changes.map(change => [change.id, change.recategorized]), [["moved", true], ["attributed", false]]);
});

function typeable(id: string, counterparty: string, fields: Partial<{
  amount_minor: number;
  type: "income" | "expense" | "transfer";
  type_rule_id: string | null;
  transfer_detected: number
}> = {}) {
  return {
    ...booking(id, counterparty),
    amount_minor: -500,
    type: "expense" as const,
    type_rule_id: null,
    type_transfer_account_id: null,
    transfer_detected: 0,
    ...fields
  };
}

test("rule types are set, released to the derived type, or left alone", () => {
  const rules = prepareRules([rule({
    id: "savings",
    pattern: "savings",
    category_id: "transfers",
    transaction_type: "transfer",
    transfer_account_id: "savings-account"
  })]);
  const changes = decideRuleTypeChanges([
    typeable("set", "Savings"),
    typeable("released-refund", "Shop", {
      amount_minor: 500,
      type: "expense",
      type_rule_id: "gone"
    }),
    typeable("released-reported", "Bank", {
      type: "expense",
      type_rule_id: "gone",
      transfer_detected: 1
    }),
    typeable("untouched", "Shop")
  ], rules);

  assert.deepEqual(changes, [{
    id: "set",
    type: "transfer",
    type_rule_id: "savings",
    type_transfer_account_id: "savings-account",
    changed: true
  }, {
    id: "released-refund",
    type: "income",
    type_rule_id: null,
    type_transfer_account_id: null,
    changed: true
  }, {
    id: "released-reported",
    type: "transfer",
    type_rule_id: null,
    type_transfer_account_id: null,
    changed: true
  }]);
});

test("an adopting rule without a type releases only types an earlier rule set", () => {
  const entries = [{
    id: "ruled",
    account_id: "checking",
    amount_minor: 1500,
    type_rule_id: "earlier",
    transfer_detected: 0
  }, {
    id: "automatic",
    account_id: "checking",
    amount_minor: 1500,
    type_rule_id: null,
    transfer_detected: 0
  }];

  assert.deepEqual(decideAdoptedTypes({
    id: "new",
    transaction_type: null,
    transfer_account_id: null
  }, entries), [{
    id: "ruled",
    type: "income",
    type_rule_id: null,
    type_transfer_account_id: null
  }]);
  assert.deepEqual(decideAdoptedTypes({
    id: "new",
    transaction_type: "expense",
    transfer_account_id: "ignored"
  }, entries).map(change => [change.id, change.type, change.type_rule_id, change.type_transfer_account_id]), [["ruled", "expense", "new", null], ["automatic", "expense", "new", null]]);
});

test("an adopting transfer rule naming the booking's own account sets a transfer to any account", () => {
  const changes = decideAdoptedTypes({
    id: "move",
    transaction_type: "transfer",
    transfer_account_id: "savings"
  }, [{
    id: "from-checking",
    account_id: "checking",
    amount_minor: -500,
    type_rule_id: null,
    transfer_detected: 0
  }, {
    id: "on-savings",
    account_id: "savings",
    amount_minor: 500,
    type_rule_id: null,
    transfer_detected: 0
  }]);

  assert.deepEqual(changes.map(change => [change.id, change.type, change.type_transfer_account_id]), [["from-checking", "transfer", "savings"], ["on-savings", "transfer", null]]);
});
