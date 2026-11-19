import { ruleAssignment, prepareRules, type Rule } from "@/lib/rules";
import type { Entry, CategorizedEntry } from "./transaction-entry";

/** Assigns each entry the category of the first matching rule. Categories describe purpose only; a detected transfer is categorized like any other booking and keeps its type separately. */
export function categorizeEntries(entries: Entry[], rules: Rule[]): CategorizedEntry[] {
  const prepared = prepareRules(rules);

  return entries.map(entry => {
    const assignment = ruleAssignment(entry.counterparty, entry.description, prepared);

    return {
      ...entry,
      categoryId: assignment.categoryId,
      categoryRuleId: assignment.ruleId
    };
  });
}
