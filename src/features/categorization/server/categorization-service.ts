import { ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categorize, validatePattern } from "@/lib/rules";
import { categoryExists, insertCategory } from "./category-repository";
import { findUncorrectedTransactions, insertRule, listRules, saveRuleAssignments, setRuleEnabled } from "./rule-repository";

const ruleInput = z.object({
  name: z.string().trim().min(1).max(100),
  pattern: z.string().min(1).max(500),
  mode: z.enum(["keyword", "regex"]),
  category_id: z.string().min(1),
  priority: z.number().int().min(0).max(10000),
  enabled: z.boolean().default(true)
});

export async function createRule(payload: unknown) {
  const input = ruleInput.parse(payload);

  try {
    validatePattern(input.pattern, input.mode);
  } catch {
    throw new ValidationError("Invalid matching pattern. Regular expressions use safe RE2 syntax.");
  }

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  await insertRule(input);

  return {
    ok: true
  };
}

export async function updateRuleEnabled(id: string, payload: unknown) {
  const {
    enabled
  } = z.object({
    enabled: z.boolean()
  }).parse(payload);

  await setRuleEnabled(id, enabled);

  return {
    ok: true
  };
}

export async function createCategory(payload: unknown) {
  const {
    name
  } = z.object({
    name: z.string().trim().min(1).max(100)
  }).parse(payload);

  await insertCategory(name);

  return {
    ok: true
  };
}

export async function applyRulesToUncorrectedTransactions() {
  const rules = await listRules();
  const entries = await findUncorrectedTransactions();
  const assignments = entries.map(entry => ({
    id: entry.id,
    category_id: categorize(entry.counterparty, entry.description, rules)
  }));

  await saveRuleAssignments(assignments);

  return {
    updated: entries.length
  };
}
