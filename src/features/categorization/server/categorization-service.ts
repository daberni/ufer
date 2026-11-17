import { randomUUID } from "node:crypto";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categorize, prepareRules, validatePattern } from "@/lib/rules";
import { normalizeCategoryName } from "@/lib/category-name";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryExists, insertCategory, updateCategory, type CategoryDetails, type CategoryWriteResult } from "./category-repository";
import { findUncorrectedTransactions, insertRule, listRules, saveRuleAssignments, setRuleEnabled, updateRule } from "./rule-repository";

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

  validatePattern(input.pattern, input.mode);

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  await insertRule(input);

  return {
    ok: true
  };
}

/** Editing the matching details never changes enabled state or existing transaction assignments. */
export async function updateRuleDetails(id: string, payload: unknown) {
  const input = ruleInput.omit({
    enabled: true
  }).strict().parse(payload);

  validatePattern(input.pattern, input.mode);

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  if (!(await updateRule(id, input))) {
    throw new HttpError(404, "Rule not found.");
  }

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

  if (!(await setRuleEnabled(id, enabled))) {
    throw new HttpError(404, "Rule not found.");
  }

  return {
    ok: true
  };
}

const defaultCategoryColor = "#638777";

const categoryColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value such as #638777.").transform(value => value.toLowerCase());

// An empty form value or null means no icon.
const categoryIcon = z.string().nullable();

const categoryInput = z.object({
  name: z.string().trim().min(1).max(100).transform(normalizeCategoryName),
  color: categoryColor,
  icon: categoryIcon
});

function categoryDetails(input: z.infer<typeof categoryInput>): CategoryDetails {
  const icon = input.icon || null;

  if (icon !== null && !isCategoryIcon(icon)) {
    throw new ValidationError("Choose one of the available category icons.");
  }

  return {
    name: input.name,
    color: input.color,
    icon
  };
}

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
    color: categoryColor.default(defaultCategoryColor),
    icon: categoryIcon.default(null)
  }).parse(payload);

  const id = randomUUID();

  requireSaved(await insertCategory(id, categoryDetails(input)));

  // The id lets the client select a category it has just created.
  return {
    ok: true,
    id
  };
}

export async function updateCategoryDetails(id: string, payload: unknown) {
  const input = categoryInput.parse(payload);

  requireSaved(await updateCategory(id, categoryDetails(input)));

  return {
    ok: true
  };
}

export async function applyRulesToUncorrectedTransactions() {
  const rules = prepareRules(await listRules());
  const entries = await findUncorrectedTransactions();
  const changes = entries.flatMap(entry => {
    const categoryId = categorize(entry.counterparty, entry.description, rules);

    return categoryId === entry.category_id ? [] : [{
      id: entry.id,
      category_id: categoryId
    }];
  });

  await saveRuleAssignments(changes);

  return {
    updated: changes.length
  };
}
