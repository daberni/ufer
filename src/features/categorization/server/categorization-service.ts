import { randomUUID } from "node:crypto";
import { HttpError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import { validatePattern, type Rule } from "@/features/categorization/server/rule-assignment";
import { normalizeCategoryName } from "@/lib/category-name";
import { maximumRules, nextPriority, orderedPriorities } from "@/features/categorization/rule-order";
import { isCategoryIcon } from "@/features/categorization/category-icons";
import { newCategoryColor, type ColoredCategory } from "@/features/categorization/category-color-suggestions";
import { activeAccountExists } from "@/features/accounts/server/account-repository";
import { ruleTransactionTypes } from "@/lib/transaction-types";
import { categoryExists, deleteCategory as deleteStoredCategory, insertCategory, readCategoryUsage, updateCategory, type CategoryDetails, type CategoryWriteResult } from "./category-repository";
import { listRules, type RuleLimitReached } from "./rule-repository";
import { formatCount } from "@/lib/locale";
import { currentFormatLocale } from "@/server/http/request-locale";

const ruleMatching = {
  pattern: z.string().min(1).max(500),
  mode: z.enum(["keyword", "regex"]),
  // The list order is the priority. Omitted, a new rule goes to the end of the list and an edited rule keeps its position.
  priority: z.number().int().min(0).max(10000).optional()
};

function emptyAsNull(value: unknown) {
  return value === "" ? null : value;
}

const ruleInput = z.object({
  // A preview supplies the exact new ID whose tie-breaking position was counted.
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  ...ruleMatching,
  category_id: z.string().min(1),
  // An empty form value or null leaves the automatic type; a transfer may name the own account on its other side.
  transaction_type: z.preprocess(emptyAsNull, z.enum(ruleTransactionTypes).nullable().default(null)),
  transfer_account_id: z.preprocess(emptyAsNull, z.string().min(1).max(200).nullable().default(null)),
  // Limits the rule to the bookings of one account; empty or null matches every account.
  account_id: z.preprocess(emptyAsNull, z.string().min(1).max(200).nullable().default(null)),
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
  // Counts only the bookings of this account, as the rule's account condition will.
  account_id: z.preprocess(emptyAsNull, z.string().min(1).max(200).nullable().default(null)),
  // An edited rule is counted in place of its stored version.
  rule_id: z.string().min(1).optional(),
  // Counts the manual assignments the rule decides that already have this category.
  category_id: z.string().min(1).optional(),
  // The transaction a rule is created from is adopted on its own terms, so it is not counted among the other manual assignments.
  source_transaction_id: z.string().min(1).optional()
});

/**
 * Rejects a counterpart account for a rule that sets no transfer, and an account that is not one of the workspace's own.
 * An edited rule may keep its stored target unchanged, such as the marker of a deleted account, which matches no account.
 */
type TransferTarget = {
  transaction_type: Rule["transaction_type"];
  transfer_account_id: Rule["transfer_account_id"];
};

const inactiveTargetMessage = "Choose one of your active accounts for the transfer.";
const inactiveConditionMessage = "Choose one of your active accounts for the rule.";

function validateTransferTarget(input: TransferTarget) {
  if (input.transfer_account_id && input.transaction_type !== "transfer") {
    throw new ValidationError("Only a transfer rule can name an account.");
  }
}

async function validateRuleType(input: TransferTarget) {
  validateTransferTarget(input);

  if (input.transfer_account_id && !(await activeAccountExists(input.transfer_account_id))) {
    throw new ValidationError(inactiveTargetMessage);
  }
}

/** A rule creation request after validation: the rule without its position, the optional priority, and the assignments a person chose. */
export async function parseRuleCreation(payload: unknown) {
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

  await validateRuleType(input);

  if (input.account_id && !(await activeAccountExists(input.account_id))) {
    throw new ValidationError(inactiveConditionMessage);
  }

  // A previewed ID decides equal-priority ties exactly as counted, so it must not belong to another rule.
  if (previewId !== undefined && (await listRules()).some(rule => rule.id === previewId)) {
    throw new HttpError(409, "This rule preview is outdated. Check the preview and try again.");
  }

  const {
    priority,
    ...details
  } = input;

  return {
    rule: {
      ...details,
      id: previewId ?? randomUUID()
    },
    priority,
    applyToUncategorized,
    sourceTransactionId,
    adoptManual
  };
}

/** A rule edit after validation. Editing the matching details never changes enabled state. */
export async function parseRuleUpdate(payload: unknown) {
  const {
    adopt_manual: adoptManual,
    ...details
  } = ruleInput.omit({
    id: true,
    enabled: true,
    apply_to_uncategorized: true,
    source_transaction_id: true
  }).strict().parse(payload);

  validatePattern(details.pattern, details.mode);

  if (!(await categoryExists(details.category_id))) {
    throw new ValidationError("Category does not exist.");
  }

  validateTransferTarget(details);

  return {
    details,
    adoptManual
  };
}

export function inactiveTargetError() {
  return new ValidationError(inactiveTargetMessage);
}

export function inactiveConditionError() {
  return new ValidationError(inactiveConditionMessage);
}

/** Words the rule limit for the request after the write transaction rolled back. */
export async function ruleLimitError(error: RuleLimitReached) {
  return new HttpError(409, `Ufer supports at most ${formatCount(error.maximum, await currentFormatLocale())} rules. Delete a rule before creating another.`);
}

export function parseRuleEnabled(payload: unknown) {
  return z.object({
    enabled: z.boolean()
  }).parse(payload).enabled;
}

const ruleOrderInput = z.object({
  ids: z.array(z.string().min(1)).max(maximumRules).refine(ids => new Set(ids).size === ids.length, "Each rule may appear only once.")
}).strict();

/** The requested matching order with the distinct priorities that store it, so the list, the rule editor and matching agree. */
export function parseRuleOrder(payload: unknown) {
  const {
    ids
  } = ruleOrderInput.parse(payload);

  return {
    ids,
    priorities: orderedPriorities(ids.length)
  };
}

/** A rule preview request after validation: the draft rule counted in place of any stored version, and the transaction a rule is created from. */
export async function parseRulePreview(payload: unknown) {
  const {
    rule_id: ruleId,
    category_id: categoryId,
    source_transaction_id: sourceTransactionId,
    ...input
  } = rulePreviewInput.parse(payload);

  validatePattern(input.pattern, input.mode);

  const storedRules = await listRules();
  const stored = ruleId === undefined ? undefined : storedRules.find(rule => rule.id === ruleId);

  if (ruleId !== undefined && !stored) {
    throw new HttpError(404, "Rule not found.");
  }

  // Editing never changes the enabled state, so an edit is counted as it will be stored.
  const enabled = stored ? stored.enabled : 1;
  // A new rule without a priority is counted after every stored rule, where appending places it.
  const priority = input.priority ?? stored?.priority ?? nextPriority(storedRules);
  const draft: Rule = {
    ...input,
    priority,
    id: ruleId ?? randomUUID(),
    name: "",
    category_id: categoryId ?? "",
    enabled
  };

  return {
    draft,
    storedRules,
    categoryId,
    sourceTransactionId
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
    color: categoryColor.optional(),
    icon: categoryIcon.default(null)
  }).parse(payload);

  const id = randomUUID();

  const {
    name,
    icon
  } = categoryDetails({
    ...input,
    color: input.color ?? ""
  });
  // Without a color, the color is chosen inside the insert's transaction from the categories it sees.
  const color = input.color ?? ((existing: ColoredCategory[]) => newCategoryColor(name, icon, existing));

  requireSaved(await insertCategory(id, {
    name,
    icon,
    color
  }));

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
