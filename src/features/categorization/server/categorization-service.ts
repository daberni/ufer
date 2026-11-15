import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categorize, validatePattern } from "@/lib/rules";
import { normalizeCategoryName } from "@/lib/category-name";
import { categoryExists, insertCategory, updateCategory, type CategoryWriteResult } from "./category-repository";
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

const defaultCategoryColor = "#638777";

const categoryColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value such as #638777.").transform(value => value.toLowerCase());

const categoryInput = z.object({
  name: z.string().trim().min(1).max(100).transform(normalizeCategoryName),
  color: categoryColor
});

function requireSaved(result: CategoryWriteResult) {
  if (result === "name_taken") {
    throw new ValidationError("A category with this name already exists.");
  }

  if (result === "not_found") {
    throw new HttpError(404, "Category not found.");
  }
}

export async function createCategory(payload: unknown) {
  const input = categoryInput.extend({
    color: categoryColor.default(defaultCategoryColor)
  }).parse(payload);

  requireSaved(await insertCategory(input));

  return {
    ok: true
  };
}

export async function updateCategoryDetails(id: string, payload: unknown) {
  const input = categoryInput.parse(payload);

  requireSaved(await updateCategory(id, input));

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
