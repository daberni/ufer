import { randomUUID } from "node:crypto";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { categorize, decidingRule, prepareRules, validatePattern, type Rule } from "@/lib/rules";
import { normalizeCategoryName } from "@/lib/category-name";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { defaultCategoryColor } from "@/features/categorization/category-colors";
import { categoryExists, insertCategory, updateCategory, type CategoryDetails, type CategoryWriteResult } from "./category-repository";
import { findUncorrectedTransactions, insertRule, listRules, saveRuleAssignments, setRuleEnabled, updateRule, type SelectRuleAssignments } from "./rule-repository";

const ruleMatching = {
  pattern: z.string().min(1).max(500),
  mode: z.enum(["keyword", "regex"]),
  priority: z.number().int().min(0).max(10000)
};

const ruleInput = z.object({
  // A preview supplies the exact new ID whose tie-breaking position was counted.
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  ...ruleMatching,
  category_id: z.string().min(1),
  enabled: z.boolean().default(true),
  // Gives the rule's category to the transactions it decides that are still uncategorized; other matches change when rules are applied.
  apply_to_uncategorized: z.boolean().default(false)
});

const rulePreviewInput = z.object(ruleMatching);

/**
 * Transactions without a manual assignment decided by this rule, using the same persisted-ID tie-break as future matching.
 */
async function transactionsDecidedBy(rule: Rule) {
  const rules = prepareRules([...(await listRules()), rule]);
  const entries = await findUncorrectedTransactions();

  return entries.filter(entry => decidingRule(entry.counterparty, entry.description, rules)?.id === rule.id);
}

/** Counts the transactions a new enabled rule would categorize, without storing it. Manual assignments are never counted. */
export async function previewRule(payload: unknown) {
  const input = rulePreviewInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  const id = randomUUID();
  const decided = await transactionsDecidedBy({
    ...input,
    id,
    name: "",
    category_id: "",
    enabled: 1
  });

  return {
    id,
    matched: decided.length,
    uncategorized: decided.filter(entry => entry.category_id === null).length
  };
}

export async function createRule(payload: unknown) {
  const {
    apply_to_uncategorized: applyToUncategorized,
    id: previewId,
    ...input
  } = ruleInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  const rule = {
    ...input,
    id: previewId ?? randomUUID()
  };
  const selectAssignments: SelectRuleAssignments | undefined = applyToUncategorized ? (storedRules, entries) => {
    const rules = prepareRules(storedRules);

    return entries.filter(entry => decidingRule(entry.counterparty, entry.description, rules)?.id === rule.id).map(entry => entry.id);
  } : undefined;
  const categorized = await insertRule(rule, selectAssignments);

  return {
    ok: true,
    categorized
  };
}

/** Editing the matching details never changes enabled state or existing transaction assignments. */
export async function updateRuleDetails(id: string, payload: unknown) {
  const input = ruleInput.omit({
    id: true,
    enabled: true,
    apply_to_uncategorized: true
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
