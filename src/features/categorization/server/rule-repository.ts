import { and, count, eq, inArray, isNull, asc } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import type { Rule } from "@/lib/rules";
import { highestPriority, maximumRules, nextPriority, orderedPriorities } from "@/features/categorization/rule-order";
import type { Transaction } from "@/server/database/models";
import { accounts, categorizationRules, transactions } from "@/server/database/schema";

/** Rules in matching order: priority first, then their persisted ID. */
export async function listRules() {
  const db = await database();

  return db.select().from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

export type NewRule = Omit<Rule, "enabled"> & {
  enabled: boolean;
};

// Bounds the bound parameters of each update for both local SQLite and remote libSQL deployments.
const assignmentChunkSize = 500;

type RuleCandidate = Pick<Transaction, "id" | "counterparty" | "description">;

export type SelectRuleAssignments = (rules: Rule[], entries: RuleCandidate[]) => string[];

/**
 * Rejects adding rules beyond the limit, inside the caller's write transaction, so concurrent creations cannot exceed it.
 */
export async function requireRuleCapacity(tx: DatabaseTransaction, added: number) {
  const stored = await tx.select({
    total: count()
  }).from(categorizationRules).get();

  if ((stored?.total ?? 0) + added > maximumRules) {
    throw new HttpError(409, `Ufer supports at most ${maximumRules.toLocaleString("en")} rules. Delete a rule before creating another.`);
  }
}

/** What a new rule assigns in its creation transaction: matching uncategorized transactions, and the manually categorized transaction it was created from. */
export type RuleCreationAssignments = {
  uncategorized?: SelectRuleAssignments;
  source?: {
    transactionId: string;
    select: SelectRuleAssignments;
  };
};

/** Hands the transaction a rule was created from to that rule when the selector confirms the rule decides its manual category. */
async function adoptSourceTransaction(tx: DatabaseTransaction, rule: NewRule, rules: Rule[], source: NonNullable<RuleCreationAssignments["source"]>) {
  const scope = and(eq(transactions.id, source.transactionId), eq(transactions.category_source, "manual"), eq(transactions.category_id, rule.category_id), inArray(transactions.account_id, tx.select({
    id: accounts.id
  }).from(accounts).where(and(eq(accounts.environment, environment()), isNull(accounts.archived_at)))));
  const candidates = await tx.select({
    id: transactions.id,
    counterparty: transactions.counterparty,
    description: transactions.description
  }).from(transactions).where(scope);

  if (source.select(rules, candidates).length === 0) {
    return;
  }

  await tx.update(transactions).set({
    category_source: "rule",
    category_rule_id: rule.id
  }).where(scope);
}

async function storeRule(tx: DatabaseTransaction, rule: NewRule, assignments: RuleCreationAssignments = {}) {
  await requireRuleCapacity(tx, 1);
  await tx.insert(categorizationRules).values({
    ...rule,
    enabled: rule.enabled ? 1 : 0
  });

  const {
    uncategorized: selectAssignments,
    source
  } = assignments;

  if (!selectAssignments && !source) {
    return 0;
  }

  const rules = await tx.select().from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));

  if (source) {
    await adoptSourceTransaction(tx, rule, rules, source);
  }

  if (!selectAssignments) {
    return 0;
  }

  // Bookings on archived accounts are read-only, so rules never recategorize them.
  const scope = and(eq(accounts.environment, environment()), isNull(accounts.archived_at), eq(transactions.category_source, "rule"), isNull(transactions.category_id));
  const candidates = await tx.select({
    id: transactions.id,
    counterparty: transactions.counterparty,
    description: transactions.description
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(scope);
  const ids = selectAssignments(rules, candidates);
  let categorized = 0;

  for (let offset = 0; offset < ids.length; offset += assignmentChunkSize) {
    const chunk = ids.slice(offset, offset + assignmentChunkSize);
    const result = await tx.update(transactions).set({
      category_id: rule.category_id,
      category_rule_id: rule.id
    }).where(and(inArray(transactions.id, chunk), inArray(transactions.account_id, tx.select({
      id: accounts.id
    }).from(accounts).where(isNull(accounts.archived_at)))));

    categorized += result.rowsAffected;
  }

  return categorized;
}

/** Reads the matching inputs and stores the rule and its optional assignments in one write transaction. */
export async function insertRule(rule: NewRule, assignments?: RuleCreationAssignments) {
  const db = await database();

  return db.transaction(tx => storeRule(tx, rule, assignments));
}

/**
 * Stores a rule after every stored rule, with its optional assignments, in one write transaction. When the next priority would leave the allowed range, the stored
 * rules are first renumbered in their current matching order, which keeps their order and leaves room at the end.
 */
export async function appendRule(rule: Omit<NewRule, "priority">, assignments?: RuleCreationAssignments) {
  const db = await database();

  return db.transaction(async tx => {
    const stored = await tx.select({
      id: categorizationRules.id,
      priority: categorizationRules.priority
    }).from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));

    await requireRuleCapacity(tx, 1);

    let priority = nextPriority(stored);

    if (priority > highestPriority) {
      const renumbered = orderedPriorities(stored.length + 1);

      for (const [index, existing] of stored.entries()) {
        await tx.update(categorizationRules).set({
          priority: renumbered[index]
        }).where(eq(categorizationRules.id, existing.id));
      }

      priority = renumbered[stored.length];
    }

    return storeRule(tx, {
      ...rule,
      priority
    }, assignments);
  });
}

/** Updates the rule's details; without a priority the rule keeps its position in the matching order. */
export async function updateRule(id: string, details: Pick<Rule, "name" | "pattern" | "mode" | "category_id"> & Partial<Pick<Rule, "priority">>) {
  const db = await database();
  const result = await db.update(categorizationRules).set(details).where(eq(categorizationRules.id, id));

  return result.rowsAffected > 0;
}

export async function setRuleEnabled(id: string, enabled: boolean) {
  const db = await database();

  const result = await db.update(categorizationRules).set({
    enabled: enabled ? 1 : 0
  }).where(eq(categorizationRules.id, id));

  return result.rowsAffected > 0;
}

export async function findUncorrectedTransactions() {
  const db = await database();
  // Bookings on archived accounts are read-only, so applying rules leaves them unchanged.
  const scope = and(eq(accounts.environment, environment()), isNull(accounts.archived_at), eq(transactions.category_source, "rule"));

  return db.select({
    id: transactions.id,
    category_id: transactions.category_id,
    category_rule_id: transactions.category_rule_id,
    counterparty: transactions.counterparty,
    description: transactions.description
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(scope);
}

export async function saveRuleAssignments(entries: Pick<Transaction, "id" | "category_id" | "category_rule_id">[]) {
  const db = await database();
  // An account archived after the candidates were read stays read-only.
  const activeAccounts = db.select({
    id: accounts.id
  }).from(accounts).where(isNull(accounts.archived_at));
  const [first, ...rest] = entries.map(entry => db.update(transactions).set({
    category_id: entry.category_id,
    category_rule_id: entry.category_rule_id
  }).where(and(eq(transactions.id, entry.id), eq(transactions.category_source, "rule"), inArray(transactions.account_id, activeAccounts))));

  if (first) {
    await db.batch([first, ...rest]);
  }

}

/** Deletes the rule and, in the same write transaction, its references from the categories it assigned, which keep their category. */
export async function deleteRule(id: string) {
  const db = await database();

  return db.transaction(async tx => {
    const result = await tx.delete(categorizationRules).where(eq(categorizationRules.id, id));

    await tx.update(transactions).set({
      category_rule_id: null
    }).where(eq(transactions.category_rule_id, id));

    return result.rowsAffected > 0;
  });
}

/**
 * Stores the given matching order as distinct priorities in one write transaction. Only priorities change; transactions keep their categories until rules are applied.
 * Returns false when the IDs are not exactly the stored rules, for example after another tab added or deleted one.
 */
export async function saveRuleOrder(ids: string[], priorities: number[]) {
  const db = await database();

  return db.transaction(async tx => {
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
  });
}
