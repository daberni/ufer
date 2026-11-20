import { ruleAssignment, prepareRules, type Rule, type RuleText } from "@/lib/rules";
import type { Entry, CategorizedEntry } from "./transaction-entry";

/** Assigns each entry the category and any type of the first matching rule; an entry carries the stored overrides of the row it updates. Categories describe purpose only; a detected transfer is categorized like any other booking and keeps its type separately. */
export function categorizeEntries<Categorized extends Entry>(entries: (Categorized & Pick<RuleText, "counterparty_override" | "description_override">)[], rules: Rule[]): (Categorized & CategorizedEntry)[] {
  const prepared = prepareRules(rules);

  return entries.map(entry => {
    const assignment = ruleAssignment(entry, prepared);

    return {
      ...entry,
      categoryId: assignment.categoryId,
      categoryRuleId: assignment.ruleId,
      ruleType: assignment.type,
      typeRuleId: assignment.type ? assignment.ruleId : null
    };
  });
}
