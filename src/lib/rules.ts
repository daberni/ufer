import { RE2JS, RE2JSSyntaxException } from "re2js";
import { ValidationError } from "@/lib/errors";
import type { CategorizationRule } from "@/server/database/models";

export type Rule = CategorizationRule;

export type PreparedRule = {
  categoryId: string;
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

// Sorts the enabled rules by precedence and compiles their patterns once for a whole batch.
export function prepareRules(rules: Rule[]): PreparedRule[] {
  return rules.filter(rule => rule.enabled).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(rule => {
    if (rule.mode === "regex") {
      const regex = compileRegex(rule.pattern);

      return {
        categoryId: rule.category_id,
        matches: text => regex.matcher(text).find()
      };
    }

    const keyword = rule.pattern.toLocaleLowerCase("en-GB");

    return {
      categoryId: rule.category_id,
      matches: text => text.toLocaleLowerCase("en-GB").includes(keyword)
    };
  });
}

export function categorize(counterparty: string, description: string, rules: PreparedRule[]) {
  const text = `${counterparty} ${description}`;

  return rules.find(rule => rule.matches(text))?.categoryId ?? null;
}
