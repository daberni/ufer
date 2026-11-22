import { derivedTransactionType, type TransactionType } from "@/lib/transaction-types";
import { counterpartAccount, decidingRule, prepareRules, ruleAssignment, type PreparedRule, type Rule, type RuleText } from "@/features/categorization/server/rule-assignment";

type RuleCandidate = RuleText & {
  id: string;
};

/** Picks the candidates a rule decides from the stored rules read inside the write transaction that adopts them. */
export type SelectRuleAssignments = (rules: Rule[], entries: RuleCandidate[]) => string[];

/** The entries this rule decides, using the same persisted-ID tie-break as future matching. A stored rule with the same ID is replaced by the draft. */
export function decidedBy<Entry extends RuleCandidate>(rule: Rule, storedRules: Rule[], entries: Entry[]) {
  const others = storedRules.filter(stored => stored.id !== rule.id);
  const rules = prepareRules([...others, rule]);

  return entries.filter(entry => decidingRule(entry, rules)?.id === rule.id);
}

/** Selects the candidates the stored rule with this ID decides. */
export function decidedByStoredRule(ruleId: string): SelectRuleAssignments {
  return (storedRules, entries) => {
    const rules = prepareRules(storedRules);

    return entries.filter(entry => decidingRule(entry, rules)?.id === ruleId).map(entry => entry.id);
  };
}

/** A rule-categorized booking as re-applying the rules sees it. */
export type CategorizedByRule = RuleText & {
  id: string;
  category_id: string | null;
  category_rule_id: string | null;
};

export type RuleCategoryChange = {
  id: string;
  category_id: string | null;
  category_rule_id: string | null;
  /** False when only the deciding rule's reference changes. */
  recategorized: boolean;
};

/** The category and deciding-rule changes re-applying the rules makes; unchanged bookings are omitted. */
export function decideRuleCategoryChanges(entries: CategorizedByRule[], rules: PreparedRule[]): RuleCategoryChange[] {
  return entries.flatMap(entry => {
    const assignment = ruleAssignment(entry, rules);
    const recategorized = assignment.categoryId !== entry.category_id;

    if (!recategorized && assignment.ruleId === entry.category_rule_id) {
      return [];
    }

    return [{
      id: entry.id,
      category_id: assignment.categoryId,
      category_rule_id: assignment.ruleId,
      recategorized
    }];
  });
}

/** A booking whose type rules may set, with the rule that set its current type. */
export type RuleTypeable = RuleText & {
  id: string;
  amount_minor: number;
  type: TransactionType;
  type_rule_id: string | null;
  type_transfer_account_id: string | null;
  transfer_detected: number;
};

export type RuleTypeChange = {
  id: string;
  type: TransactionType;
  type_rule_id: string | null;
  type_transfer_account_id: string | null;
  /** False when only the rule reference or transfer account changes. */
  changed: boolean;
};

/** The derived type a booking returns to once no rule sets its type: Transfer for a booking the bank or file reported as one. */
function releasedType(entry: Pick<RuleTypeable, "amount_minor" | "transfer_detected">) {
  return derivedTransactionType(entry.amount_minor, entry.transfer_detected === 1);
}

/**
 * The types rules decide on bookings that neither a person nor a link decided. A type a rule set earlier returns to the derived type when no rule sets one any more; a
 * detected transfer without a rule stays a transfer. Unchanged bookings are omitted.
 */
export function decideRuleTypeChanges(entries: RuleTypeable[], rules: PreparedRule[]): RuleTypeChange[] {
  return entries.flatMap(entry => {
    const assignment = ruleAssignment(entry, rules);
    const decided = assignment.type ? {
      type: assignment.type,
      ruleId: assignment.ruleId,
      transferAccountId: assignment.transferAccountId
    } : undefined;
    const released = !decided && entry.type_rule_id !== null ? {
      type: releasedType(entry),
      ruleId: null,
      transferAccountId: null
    } : undefined;
    const next = decided ?? released;

    if (!next || (next.type === entry.type && next.ruleId === entry.type_rule_id && next.transferAccountId === entry.type_transfer_account_id)) {
      return [];
    }

    return [{
      id: entry.id,
      type: next.type,
      type_rule_id: next.ruleId,
      type_transfer_account_id: next.transferAccountId,
      changed: next.type !== entry.type
    }];
  });
}

/**
 * The types a rule sets on bookings it was just given. A rule with a type sets it with a reference to itself; a rule without a type returns a type an earlier rule set
 * to the derived type, as applying rules does, and leaves other bookings unchanged.
 */
export function decideAdoptedTypes(rule: Pick<Rule, "id" | "transaction_type" | "transfer_account_id">, entries: Pick<RuleTypeable, "id" | "account_id" | "amount_minor" | "type_rule_id" | "transfer_detected">[]): Omit<RuleTypeChange, "changed">[] {
  const type = rule.transaction_type;

  if (!type) {
    return entries.filter(entry => entry.type_rule_id !== null).map(entry => ({
      id: entry.id,
      type: releasedType(entry),
      type_rule_id: null,
      type_transfer_account_id: null
    }));
  }

  return entries.map(entry => ({
    id: entry.id,
    type,
    type_rule_id: rule.id,
    type_transfer_account_id: type === "transfer" ? counterpartAccount(rule.transfer_account_id, entry.account_id) : null
  }));
}
