import { RE2JS, RE2JSSyntaxException } from "re2js";
import { ValidationError } from "@/lib/errors";
// eslint-disable-next-line boundaries/dependencies -- known violation tracked in daberni/ufer#285
import type { CategorizationRule } from "@/server/database/models";
import type { RuleTransactionType } from "@/lib/transaction-types";

/** A stored rule; a rule without a type may omit the type fields. */
export type Rule = Omit<CategorizationRule, "transaction_type" | "transfer_account_id"> & Partial<Pick<CategorizationRule, "transaction_type" | "transfer_account_id">>;

export type PreparedRule = {
  id: string;
  categoryId: string;
  /** The type the rule sets; null leaves the automatic type. */
  type: RuleTransactionType | null;
  /** For a transfer rule, the own account on the other side. */
  transferAccountId: string | null;
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
        matches: text => regex.matcher(text).find()
      };
    }

    const keyword = rule.pattern.toLocaleLowerCase("en-GB");

    return {
      id: rule.id,
      categoryId: rule.category_id,
      type: rule.transaction_type ?? null,
      transferAccountId: rule.transaction_type === "transfer" ? rule.transfer_account_id ?? null : null,
      matches: text => text.toLocaleLowerCase("en-GB").includes(keyword)
    };
  });
}

/** A transaction's text as rules see it: the source text, and a person's payee and description overrides where present. */
export type RuleText = {
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

/** The rule that decides a transaction's category: the first prepared rule that matches its source text or its overridden text. */
export function decidingRule(text: RuleText, rules: PreparedRule[]) {
  const texts = matchedTexts(text);

  return rules.find(rule => texts.some(candidate => rule.matches(candidate)));
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
    transferAccountId: rule?.transferAccountId ?? null
  };
}

export function categorize(text: RuleText, rules: PreparedRule[]) {
  return ruleAssignment(text, rules).categoryId;
}
