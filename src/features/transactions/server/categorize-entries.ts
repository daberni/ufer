import { categorize, prepareRules, type Rule } from "@/lib/rules";
import type { Entry, CategorizedEntry } from "./transaction-entry";

export function categorizeEntries(entries: Entry[], rules: Rule[]): CategorizedEntry[] {
  const prepared = prepareRules(rules);

  return entries.map(entry => ({
    ...entry,
    categoryId: entry.transfer ? "transfer" : categorize(entry.counterparty, entry.description, prepared)
  }));
}
