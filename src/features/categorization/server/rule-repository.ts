import { and, count, eq, isNull, asc } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import type { Rule } from "@/features/categorization/server/rule-assignment";
import { highestPriority, maximumRules, nextPriority, orderedPriorities } from "@/features/categorization/rule-order";
import { accounts, categorizationRules } from "@/server/database/schema";

/** Rules in matching order: priority first, then their persisted ID. */
export async function listRules() {
  const db = await database();

  return db.select().from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

/** The stored rules in matching order, read inside the caller's write transaction. */
export function readRules(tx: DatabaseTransaction) {
  return tx.select().from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

export type NewRule = Omit<Rule, "enabled"> & {
  enabled: boolean;
};

/** Refuses a rule beyond the limit; the service words the refusal for the request after the transaction has rolled back. */
export class RuleLimitReached extends Error {
  constructor(readonly maximum: number) {
    super("The rule limit is reached.");
  }
}

/**
 * Rejects adding rules beyond the limit, inside the caller's write transaction, so concurrent creations cannot exceed it.
 */
export async function requireRuleCapacity(tx: DatabaseTransaction, added: number) {
  const stored = await tx.select({
    total: count()
  }).from(categorizationRules).get();

  if ((stored?.total ?? 0) + added > maximumRules) {
    throw new RuleLimitReached(maximumRules);
  }
}

/** Stores a rule within the rule limit. */
export async function storeRule(tx: DatabaseTransaction, rule: NewRule) {
  await requireRuleCapacity(tx, 1);
  await tx.insert(categorizationRules).values({
    ...rule,
    enabled: rule.enabled ? 1 : 0
  });
}

/**
 * The priority after every stored rule. When it would leave the allowed range, the stored rules are first renumbered in their current matching order, which keeps their
 * order and leaves room at the end.
 */
export async function appendedPriority(tx: DatabaseTransaction) {
  const stored = await tx.select({
    id: categorizationRules.id,
    priority: categorizationRules.priority
  }).from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));

  await requireRuleCapacity(tx, 1);

  const priority = nextPriority(stored);

  if (priority <= highestPriority) {
    return priority;
  }

  const renumbered = orderedPriorities(stored.length + 1);

  for (const [index, existing] of stored.entries()) {
    await tx.update(categorizationRules).set({
      priority: renumbered[index]
    }).where(eq(categorizationRules.id, existing.id));
  }

  return renumbered[stored.length];
}

export type RuleDetails = Pick<Rule, "name" | "pattern" | "mode" | "category_id" | "transaction_type" | "transfer_account_id" | "account_id"> & Partial<Pick<Rule, "priority">>;

export type RuleUpdateResult = "saved" | "not_found" | "inactive_target" | "inactive_condition";

/** Updates the rule's details; without a priority the rule keeps its position in the matching order. */
export async function storeRuleDetails(tx: DatabaseTransaction, id: string, details: RuleDetails): Promise<RuleUpdateResult> {
  const stored = await tx.select({
    transfer_account_id: categorizationRules.transfer_account_id,
    account_id: categorizationRules.account_id
  }).from(categorizationRules).where(eq(categorizationRules.id, id)).get();

  if (!stored) {
    return "not_found";
  }

  // A rule may keep a target or account condition that was archived or deleted meanwhile; a newly chosen account must be active.
  const target = details.transfer_account_id;

  if (target && target !== stored.transfer_account_id && !(await activeAccount(tx, target))) {
    return "inactive_target";
  }

  const condition = details.account_id;

  if (condition && condition !== stored.account_id && !(await activeAccount(tx, condition))) {
    return "inactive_condition";
  }

  await tx.update(categorizationRules).set(details).where(eq(categorizationRules.id, id));

  return "saved";
}

async function activeAccount(tx: DatabaseTransaction, id: string) {
  const found = await tx.select({
    id: accounts.id
  }).from(accounts).where(and(eq(accounts.id, id), isNull(accounts.archived_at))).get();

  return found !== undefined;
}

export async function storeRuleEnabled(tx: DatabaseTransaction, id: string, enabled: boolean) {
  const result = await tx.update(categorizationRules).set({
    enabled: enabled ? 1 : 0
  }).where(eq(categorizationRules.id, id));

  return result.rowsAffected > 0;
}

export async function removeRule(tx: DatabaseTransaction, id: string) {
  const result = await tx.delete(categorizationRules).where(eq(categorizationRules.id, id));

  return result.rowsAffected > 0;
}

/**
 * Stores the given matching order as distinct priorities. Returns false when the IDs are not exactly the stored rules, for example after another tab added or deleted one.
 */
export async function storeRuleOrder(tx: DatabaseTransaction, ids: string[], priorities: number[]) {
  const stored = await tx.select({
    id: categorizationRules.id
  }).from(categorizationRules);
  const storedIds = new Set(stored.map(rule => rule.id));
  const sameRules = stored.length === ids.length && ids.every(id => storedIds.has(id));

  if (!sameRules) {
    return false;
  }

  for (const [index, id] of ids.entries()) {
    await tx.update(categorizationRules).set({
      priority: priorities[index]
    }).where(eq(categorizationRules.id, id));
  }

  return true;
}
