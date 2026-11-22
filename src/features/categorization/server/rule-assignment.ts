import { RE2JS, RE2JSSyntaxException } from "re2js";
import { ValidationError } from "@/lib/errors";
import type { CategorizationRule } from "@/server/database/models";
import type { RuleTransactionType } from "@/lib/transaction-types";

/** A stored rule; a rule without a type or account condition may omit those fields. */
export type Rule = Omit<CategorizationRule, "transaction_type" | "transfer_account_id" | "account_id"> & Partial<Pick<CategorizationRule, "transaction_type" | "transfer_account_id" | "account_id">>;

export type PreparedRule = {
  id: string;
  categoryId: string;
  /** The type the rule sets; null leaves the automatic type. */
  type: RuleTransactionType | null;
  /** For a transfer rule, the own account on the other side. */
  transferAccountId: string | null;
  /** The only account whose bookings the rule matches; null matches every account. */
  accountId: string | null;
  matches: (text: string) => boolean;
};

export function validatePattern(pattern: string, mode: string) {
  if (!pattern.trim() || pattern.length > 500) {
    throw new ValidationError("The matching pattern must contain 1 to 500 characters.");
  }

  if (mode === "regex") {
    compileRegex(pattern);
  }
}

function compileRegex(pattern: string) {
  try {
    return RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
  } catch (error) {
    if (error instanceof RE2JSSyntaxException) {
      throw new ValidationError("Invalid matching pattern. Regular expressions use safe RE2 syntax.");
    }

    throw error;
  }
}

// Compile enabled rules in the live precedence order: priority first, then their persisted ID.
export function prepareRules(rules: Rule[]): PreparedRule[] {
  return rules.filter(rule => rule.enabled).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(rule => {
    if (rule.mode === "regex") {
      const regex = compileRegex(rule.pattern);

      return {
        id: rule.id,
        categoryId: rule.category_id,
        type: rule.transaction_type ?? null,
        transferAccountId: rule.transaction_type === "transfer" ? rule.transfer_account_id ?? null : null,
        accountId: rule.account_id ?? null,
        matches: text => regex.matcher(text).find()
      };
    }

    const keyword = rule.pattern.toLocaleLowerCase("en-GB");

    return {
      id: rule.id,
      categoryId: rule.category_id,
      type: rule.transaction_type ?? null,
      transferAccountId: rule.transaction_type === "transfer" ? rule.transfer_account_id ?? null : null,
      accountId: rule.account_id ?? null,
      matches: text => text.toLocaleLowerCase("en-GB").includes(keyword)
    };
  });
}

/** A transaction as rules see it: its account, the source text, and a person's payee and description overrides where present. */
export type RuleText = {
  account_id: string;
  counterparty: string;
  description: string;
  counterparty_override?: string | null;
  description_override?: string | null;
};

/** The texts a rule may match: the source text, and the text with the overrides applied when the person overrode a field. */
function matchedTexts(text: RuleText) {
  const source = `${text.counterparty} ${text.description}`;

  if (text.counterparty_override == null && text.description_override == null) {
    return [source];
  }

  return [source, `${text.counterparty_override ?? text.counterparty} ${text.description_override ?? text.description}`];
}

/** The rule that decides a transaction's category: the first prepared rule for the transaction's account that matches its source text or its overridden text. */
export function decidingRule(text: RuleText, rules: PreparedRule[]) {
  const texts = matchedTexts(text);

  return rules.find(rule => (rule.accountId === null || rule.accountId === text.account_id) && texts.some(candidate => rule.matches(candidate)));
}

/** A transfer to the booking's own account could never be paired, so it behaves like a transfer to any account. */
export function counterpartAccount(transferAccountId: string | null | undefined, accountId: string) {
  return transferAccountId === accountId ? null : transferAccountId ?? null;
}

/** A rule-sourced category together with the rule that decided it; both are null when no rule matches. The same deciding rule sets the type, or leaves it automatic with a null type. */
export type RuleAssignment = {
  categoryId: string | null;
  ruleId: string | null;
  type: RuleTransactionType | null;
  transferAccountId: string | null;
};

export function ruleAssignment(text: RuleText, rules: PreparedRule[]): RuleAssignment {
  const rule = decidingRule(text, rules);

  return {
    categoryId: rule?.categoryId ?? null,
    ruleId: rule?.id ?? null,
    type: rule?.type ?? null,
    transferAccountId: counterpartAccount(rule?.transferAccountId, text.account_id)
  };
}

export function categorize(text: RuleText, rules: PreparedRule[]) {
  return ruleAssignment(text, rules).categoryId;
}

/** Prepares the stored rules and decides one transaction's assignment; callers persist the result. */
export function assignRules(rules: Rule[], text: RuleText): RuleAssignment {
  return ruleAssignment(text, prepareRules(rules));
}

/** How a booking records its rule assignment: the category with its deciding rule, and the type with the rule that set it and that rule's transfer account. */
export type EntryRuleAssignment = {
  categoryId: string | null;
  /** The rule that decided `categoryId`; null when no rule matched or the category was not assigned by a rule. */
  categoryRuleId: string | null;
  /** The type the deciding rule sets; null leaves the automatic type. */
  ruleType: RuleTransactionType | null;
  /** The rule that sets `ruleType`; null when it is null. */
  typeRuleId: string | null;
  /** The transfer account of the rule that sets `ruleType`; pairing uses it rather than the rule's current account. */
  typeTransferAccountId: string | null;
};

/** Assigns each entry of one account the category and any type of the first matching rule; an entry carries the stored overrides of the row it updates. Categories describe purpose only; a detected transfer is categorized like any other booking and keeps its type separately. */
export function categorizeEntries<Categorized extends Omit<RuleText, "account_id">>(entries: Categorized[], rules: Rule[], accountId: string): (Categorized & EntryRuleAssignment)[] {
  const prepared = prepareRules(rules);

  return entries.map(entry => {
    const assignment = ruleAssignment({
      ...entry,
      account_id: accountId
    }, prepared);

    return {
      ...entry,
      categoryId: assignment.categoryId,
      categoryRuleId: assignment.ruleId,
      ruleType: assignment.type,
      typeRuleId: assignment.type ? assignment.ruleId : null,
      typeTransferAccountId: assignment.transferAccountId
    };
  });
}
