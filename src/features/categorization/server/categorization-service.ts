import { randomUUID } from "node:crypto";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categorize, decidingRule, prepareRules, validatePattern, type Rule } from "@/lib/rules";
import { normalizeCategoryName } from "@/lib/category-name";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { categoryExists, insertCategory, updateCategory, type CategoryDetails, type CategoryWriteResult } from "./category-repository";
import { findUncorrectedTransactions, insertRule, listRules, saveRuleAssignments, setRuleEnabled } from "./rule-repository";

const rulePattern = {
  pattern: z.string().min(1).max(500),
  mode: z.enum(["keyword", "regex"])
};

const ruleInput = z.object({
  name: z.string().trim().min(1).max(100),
  ...rulePattern,
  category_id: z.string().min(1),
  priority: z.number().int().min(0).max(10000),
  enabled: z.boolean().default(true),
  // Gives the rule's category to the transactions it decides that are still uncategorized; other matches change when rules are applied.
  apply_to_uncategorized: z.boolean().default(false)
});

// Preview parameters arrive as query strings.
const rulePreviewInput = z.object({
  ...rulePattern,
  priority: z.coerce.number().int().min(0).max(10000)
});

/** Transactions without a manual assignment whose category the rule decides: it is the first matching rule in priority order. */
async function transactionsDecidedBy(rule: Rule) {
  const rules = prepareRules([...(await listRules()), rule]);
  const entries = await findUncorrectedTransactions();

  return entries.filter(entry => decidingRule(entry.counterparty, entry.description, rules)?.id === rule.id);
}

/**
 * Counts the transactions a new enabled rule would categorize, without storing it. Manual assignments are never counted. Among rules with the same
 * priority the order depends on the new rule's generated id, so the preview counts such ties for the new rule.
 */
export async function previewRule(payload: unknown) {
  const input = rulePreviewInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  const decided = await transactionsDecidedBy({
    ...input,
    id: "",
    name: "",
    category_id: "",
    enabled: 1
  });

  return {
    matched: decided.length,
    uncategorized: decided.filter(entry => entry.category_id === null).length
  };
}

export async function createRule(payload: unknown) {
  const {
    apply_to_uncategorized: applyToUncategorized,
    ...input
  } = ruleInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  const rule = {
    ...input,
    id: randomUUID()
  };
  let uncategorizedIds: string[] = [];

  if (applyToUncategorized) {
    const decided = await transactionsDecidedBy({
      ...rule,
      enabled: rule.enabled ? 1 : 0
    });

    uncategorizedIds = decided.filter(entry => entry.category_id === null).map(entry => entry.id);
  }

  const categorized = await insertRule(rule, uncategorizedIds);

  return {
    ok: true,
    categorized
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
