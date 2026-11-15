import { RE2JS } from "re2js";

export type Rule = { id: string; name: string; pattern: string; mode: string; category_id: string; priority: number; enabled: number };

export function validatePattern(pattern: string, mode: string) {
  if (!pattern.trim() || pattern.length > 500) throw new Error("The matching pattern must contain 1 to 500 characters.");
  if (mode === "regex") RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
}

export function categorize(counterparty: string, description: string, rules: Rule[]) {
  const text = `${counterparty} ${description}`;
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    if (!rule.enabled) continue;
    const matches = rule.mode === "regex" ? RE2JS.compile(rule.pattern, RE2JS.CASE_INSENSITIVE).matcher(text).find() : text.toLocaleLowerCase("en-GB").includes(rule.pattern.toLocaleLowerCase("en-GB"));
    if (matches) return rule.category_id;
  }
  return null;
}
