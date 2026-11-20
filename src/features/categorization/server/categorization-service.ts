import { randomUUID } from "node:crypto";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { decidingRule, prepareRules, ruleAssignment, validatePattern, type Rule, type RuleText } from "@/lib/rules";
import { normalizeCategoryName } from "@/lib/category-name";
import { maximumRules, nextPriority, orderedPriorities } from "@/features/categorization/rule-order";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { defaultCategoryColor } from "@/features/categorization/category-colors";
import { categoryExists, deleteCategory as deleteStoredCategory, insertCategory, readCategoryUsage, updateCategory, type CategoryDetails, type CategoryWriteResult } from "./category-repository";
import { appendRule, deleteRule as deleteStoredRule, findManualAssignments, findUncorrectedTransactions, insertRule, listRules, saveRuleAssignments, saveRuleOrder, setRuleEnabled, updateRule, type ManualAdoption, type RuleCreationAssignments, type SelectRuleAssignments } from "./rule-repository";

const ruleMatching = {
  pattern: z.string().min(1).max(500),
  mode: z.enum(["keyword", "regex"]),
  // The list order is the priority. Omitted, a new rule goes to the end of the list and an edited rule keeps its position.
  priority: z.number().int().min(0).max(10000).optional()
};

const ruleInput = z.object({
  // A preview supplies the exact new ID whose tie-breaking position was counted.
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  ...ruleMatching,
  category_id: z.string().min(1),
  enabled: z.boolean().default(true),
  // Gives the rule's category to the transactions it decides that are still uncategorized; other matches change when rules are applied.
  apply_to_uncategorized: z.boolean().default(false),
  // The manually categorized transaction the rule is created from; it becomes rule-assigned when the new rule decides its category.
  source_transaction_id: z.string().min(1).optional(),
  // Also returns the other manually categorized transactions the rule decides to automatic categorization, with the rule's category.
  adopt_manual: z.boolean().default(false)
});

const rulePreviewInput = z.object({
  ...ruleMatching,
  // An edited rule is counted in place of its stored version.
  rule_id: z.string().min(1).optional(),
  // Counts the manual assignments the rule decides that already have this category.
  category_id: z.string().min(1).optional(),
  // The transaction a rule is created from is adopted on its own terms, so it is not counted among the other manual assignments.
  source_transaction_id: z.string().min(1).optional()
});

type RuleCandidate = RuleText & {
  id: string;
};

/** The entries this rule decides, using the same persisted-ID tie-break as future matching. A stored rule with the same ID is replaced by the draft. */
function decidedBy<Entry extends RuleCandidate>(rule: Rule, storedRules: Rule[], entries: Entry[]) {
  const others = storedRules.filter(stored => stored.id !== rule.id);
  const rules = prepareRules([...others, rule]);

  return entries.filter(entry => decidingRule(entry, rules)?.id === rule.id);
}

/** Selects the candidates the stored rule with this ID decides; used inside the write transaction that adopts them. */
function decidedByStoredRule(ruleId: string): SelectRuleAssignments {
  return (storedRules, entries) => {
    const rules = prepareRules(storedRules);

    return entries.filter(entry => decidingRule(entry, rules)?.id === ruleId).map(entry => entry.id);
  };
}

/**
 * Counts the transactions a new rule, or an edited rule in its stored enabled state, would categorize, without storing it. A disabled rule decides nothing. Manual
 * assignments are counted separately: they only follow the rule when a person chooses to return them to automatic categorization.
 */
export async function previewRule(payload: unknown) {
  const {
    rule_id: ruleId,
    category_id: categoryId,
    source_transaction_id: sourceTransactionId,
    ...input
  } = rulePreviewInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  const stored = ruleId === undefined ? undefined : (await listRules()).find(rule => rule.id === ruleId);

  if (ruleId !== undefined && !stored) {
    throw new HttpError(404, "Rule not found.");
  }

  // Editing never changes the enabled state, so an edit is counted as it will be stored.
  const enabled = stored ? stored.enabled : 1;
  const id = ruleId ?? randomUUID();
  // A new rule without a priority is counted after every stored rule, where appending places it.
  const priority = input.priority ?? stored?.priority ?? nextPriority(await listRules());
  const draft: Rule = {
    ...input,
    priority,
    id,
    name: "",
    category_id: categoryId ?? "",
    enabled
  };
  const storedRules = await listRules();
  const decided = enabled ? decidedBy(draft, storedRules, await findUncorrectedTransactions()) : [];
  const manualAssignments = enabled ? (await findManualAssignments()).filter(entry => entry.id !== sourceTransactionId) : [];
  const decidedManual = decidedBy(draft, storedRules, manualAssignments);

  return {
    id,
    enabled: Boolean(enabled),
    matched: decided.length,
    uncategorized: decided.filter(entry => entry.category_id === null).length,
    manual: decidedManual.length,
    manual_same_category: decidedManual.filter(entry => categoryId !== undefined && entry.category_id === categoryId).length
  };
}

export async function createRule(payload: unknown) {
  const {
    apply_to_uncategorized: applyToUncategorized,
    source_transaction_id: sourceTransactionId,
    adopt_manual: adoptManual,
    id: previewId,
    ...input
  } = ruleInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  // A previewed ID decides equal-priority ties exactly as counted, so it must not belong to another rule.
  if (previewId !== undefined && (await listRules()).some(rule => rule.id === previewId)) {
    throw new HttpError(409, "This rule preview is outdated. Check the preview and try again.");
  }

  const {
    priority,
    ...details
  } = input;
  const rule = {
    ...details,
    id: previewId ?? randomUUID()
  };
  const decidedByRule = decidedByStoredRule(rule.id);
  const assignments: RuleCreationAssignments = {
    uncategorized: applyToUncategorized ? decidedByRule : undefined,
    source: sourceTransactionId === undefined ? undefined : {
      transactionId: sourceTransactionId,
      select: decidedByRule
    },
    manual: adoptManual ? {
      select: decidedByRule,
      excludedTransactionId: sourceTransactionId
    } : undefined
  };
  const categorized = priority === undefined ? await appendRule(rule, assignments) : await insertRule({
    ...rule,
    priority
  }, assignments);

  return {
    ok: true,
    categorized
  };
}

/** Editing the matching details never changes enabled state; existing assignments only change for the manual assignments a person chose to hand to the rule. */
export async function updateRuleDetails(id: string, payload: unknown) {
  const {
    adopt_manual: adoptManual,
    ...input
  } = ruleInput.omit({
    id: true,
    enabled: true,
    apply_to_uncategorized: true,
    source_transaction_id: true
  }).strict().parse(payload);

  validatePattern(input.pattern, input.mode);

  if (!(await categoryExists(input.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  const manual: ManualAdoption | undefined = adoptManual ? {
    select: decidedByStoredRule(id)
  } : undefined;

  if (!(await updateRule(id, input, manual))) {
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

/** Deleting a rule keeps the categories it already assigned, without a reference to the deleted rule; only future applications of the rules change. */
export async function deleteRule(id: string) {
  if (!(await deleteStoredRule(id))) {
    throw new HttpError(404, "Rule not found.");
  }

  return {
    ok: true
  };
}

const ruleOrderInput = z.object({
  ids: z.array(z.string().min(1)).max(maximumRules).refine(ids => new Set(ids).size === ids.length, "Each rule may appear only once.")
}).strict();

/**
 * Stores a new matching order. The order is saved as distinct priorities, so the list, the rule editor and matching agree. Existing assignments stay unchanged until rules are applied.
 */
export async function reorderRules(payload: unknown) {
  const {
    ids
  } = ruleOrderInput.parse(payload);

  if (!(await saveRuleOrder(ids, orderedPriorities(ids.length)))) {
    throw new HttpError(409, "The rules have changed. Reload them and try again.");
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

export async function categoryUsage(id: string) {
  const usage = await readCategoryUsage(id);

  if (!usage) {
    throw new HttpError(404, "Category not found.");
  }

  return {
    transactions: usage.transactions,
    manual_transactions: usage.manualTransactions,
    rules: usage.rules
  };
}

const categoryDeletionInput = z.object({
  // Null leaves the category's transactions uncategorized and deletes its rules, which cannot exist without a category.
  replacement_id: z.string().min(1).nullable()
}).strict();

export async function deleteCategory(id: string, payload: unknown) {
  const {
    replacement_id: replacementId
  } = categoryDeletionInput.parse(payload);

  if (replacementId === id) {
    throw new ValidationError("Choose a different category for the transactions and rules.");
  }

  const result = await deleteStoredCategory(id, {
    replacementId
  });

  if (result.status === "not_found") {
    throw new HttpError(404, "Category not found.");
  }

  if (result.status !== "deleted") {
    throw new ValidationError("The chosen replacement category does not exist.");
  }

  return {
    ok: true,
    transactions: result.transactions,
    rules: result.rules
  };
}

export async function applyRulesToUncorrectedTransactions() {
  const rules = prepareRules(await listRules());
  const entries = await findUncorrectedTransactions();
  let recategorized = 0;
  const changes = entries.flatMap(entry => {
    const assignment = ruleAssignment(entry, rules);
    const categoryChanged = assignment.categoryId !== entry.category_id;

    if (!categoryChanged && assignment.ruleId === entry.category_rule_id) {
      return [];
    }

    if (categoryChanged) {
      recategorized += 1;
    }

    return [{
      id: entry.id,
      category_id: assignment.categoryId,
      category_rule_id: assignment.ruleId
    }];
  });

  await saveRuleAssignments(changes);

  // Recording which rule decides an unchanged category is not reported as an update.
  return {
    updated: recategorized
  };
}
