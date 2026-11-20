import { and, count, eq, inArray, isNotNull, isNull, asc, sql } from "drizzle-orm";
import { HttpError } from "@/lib/errors";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import type { Rule } from "@/lib/rules";
import { highestPriority, maximumRules, nextPriority, orderedPriorities } from "@/features/categorization/rule-order";
import type { Transaction } from "@/server/database/models";
import { accounts, categorizationRules, transactions } from "@/server/database/schema";
import { pairTransfers } from "@/features/transactions/server/transfer-repository";

/** Rules in matching order: priority first, then their persisted ID. */
export async function listRules() {
  const db = await database();

  return db.select().from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

export type NewRule = Omit<Rule, "enabled"> & {
  enabled: boolean;
};

/** A booking whose type rules may set: neither a person nor a link decided it. */
const ruleTypeable = and(eq(transactions.type_source, "auto"), isNull(transactions.transfer_id));

// Bounds the bound parameters of each update for both local SQLite and remote libSQL deployments.
const assignmentChunkSize = 500;

type RuleCandidate = Pick<Transaction, "id" | "counterparty" | "description" | "counterparty_override" | "description_override">;

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

/** What a new rule assigns in its creation transaction: matching uncategorized transactions, the manually categorized transaction it was created from, and other manual assignments a person chose to hand to it. */
export type RuleCreationAssignments = {
  uncategorized?: SelectRuleAssignments;
  source?: {
    transactionId: string;
    select: SelectRuleAssignments;
  };
  manual?: ManualAdoption;
};

/** Manual assignments a rule takes over: the selector picks those the rule decides; the excluded transaction is handled separately. */
export type ManualAdoption = {
  select: SelectRuleAssignments;
  excludedTransactionId?: string;
};

/** Returns the selected manual assignments to automatic categorization with the rule's category and a reference to the rule; resolves to the selected IDs. */
async function adoptManualAssignments(tx: DatabaseTransaction, rule: Pick<Rule, "id" | "category_id">, rules: Rule[], adoption: ManualAdoption) {
  const scope = and(eq(accounts.environment, environment()), isNull(accounts.archived_at), eq(transactions.category_source, "manual"));
  const candidates = await tx.select({
    id: transactions.id,
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(scope);
  const eligible = candidates.filter(candidate => candidate.id !== adoption.excludedTransactionId);
  const ids = adoption.select(rules, eligible);

  for (let offset = 0; offset < ids.length; offset += assignmentChunkSize) {
    const chunk = ids.slice(offset, offset + assignmentChunkSize);

    await tx.update(transactions).set({
      category_id: rule.category_id,
      category_source: "rule",
      category_rule_id: rule.id
    }).where(and(inArray(transactions.id, chunk), eq(transactions.category_source, "manual")));
  }

  return ids;
}

/**
 * Sets the rule's type on the bookings it was just given, unless a person or a link decided their type, then pairs transfers so they link to, or create, their counterparts.
 * A rule without a type returns a type an earlier rule set to the derived type, as applying rules does; a booking reported as a transfer returns to Transfer.
 */
async function applyRuleType(tx: DatabaseTransaction, rule: Pick<Rule, "id" | "transaction_type" | "transfer_account_id">, ids: string[]) {
  if (ids.length === 0) {
    return;
  }

  if (!rule.transaction_type) {
    for (let offset = 0; offset < ids.length; offset += assignmentChunkSize) {
      await tx.update(transactions).set({
        type: sql`CASE WHEN ${transactions.transfer_detected}=1 THEN 'transfer' WHEN ${transactions.amount_minor}>0 THEN 'income' ELSE 'expense' END`,
        type_rule_id: null,
        type_transfer_account_id: null
      }).where(and(inArray(transactions.id, ids.slice(offset, offset + assignmentChunkSize)), ruleTypeable, isNotNull(transactions.type_rule_id)));
    }

    // A booking released to a reported transfer can now pair.
    await pairTransfers(tx, environment());

    return;
  }

  for (let offset = 0; offset < ids.length; offset += assignmentChunkSize) {
    await tx.update(transactions).set({
      type: rule.transaction_type,
      type_rule_id: rule.id,
      type_transfer_account_id: rule.transaction_type === "transfer" ? rule.transfer_account_id ?? null : null
    }).where(and(inArray(transactions.id, ids.slice(offset, offset + assignmentChunkSize)), ruleTypeable));
  }

  await pairTransfers(tx, environment());
}

function readRules(tx: DatabaseTransaction) {
  return tx.select().from(categorizationRules).orderBy(asc(categorizationRules.priority), asc(categorizationRules.id));
}

/** Hands the transaction a rule was created from to that rule when the selector confirms the rule decides its manual category; resolves to the adopted IDs. */
async function adoptSourceTransaction(tx: DatabaseTransaction, rule: NewRule, rules: Rule[], source: NonNullable<RuleCreationAssignments["source"]>) {
  const scope = and(eq(transactions.id, source.transactionId), eq(transactions.category_source, "manual"), eq(transactions.category_id, rule.category_id), inArray(transactions.account_id, tx.select({
    id: accounts.id
  }).from(accounts).where(and(eq(accounts.environment, environment()), isNull(accounts.archived_at)))));
  const candidates = await tx.select({
    id: transactions.id,
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
  }).from(transactions).where(scope);

  const adopted = source.select(rules, candidates);

  if (adopted.length === 0) {
    return [];
  }

  await tx.update(transactions).set({
    category_source: "rule",
    category_rule_id: rule.id
  }).where(scope);

  return adopted;
}

async function storeRule(tx: DatabaseTransaction, rule: NewRule, assignments: RuleCreationAssignments = {}) {
  await requireRuleCapacity(tx, 1);
  await tx.insert(categorizationRules).values({
    ...rule,
    enabled: rule.enabled ? 1 : 0
  });

  const {
    uncategorized: selectAssignments,
    source,
    manual
  } = assignments;

  if (!selectAssignments && !source && !manual) {
    return 0;
  }

  const rules = await readRules(tx);
  const adopted = [...(source ? await adoptSourceTransaction(tx, rule, rules, source) : []), ...(manual ? await adoptManualAssignments(tx, rule, rules, manual) : [])];

  if (!selectAssignments) {
    await applyRuleType(tx, rule, adopted);

    return 0;
  }

  // Bookings on archived accounts are read-only, so rules never recategorize them.
  const scope = and(eq(accounts.environment, environment()), isNull(accounts.archived_at), eq(transactions.category_source, "rule"), isNull(transactions.category_id));
  const candidates = await tx.select({
    id: transactions.id,
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
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

  await applyRuleType(tx, rule, [...adopted, ...ids]);

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

/**
 * Updates the rule's details; without a priority the rule keeps its position in the matching order. Chosen manual assignments the updated rule decides are returned to
 * it in the same write transaction. Resolves to false for a missing rule.
 */
export async function updateRule(id: string, details: Pick<Rule, "name" | "pattern" | "mode" | "category_id" | "transaction_type" | "transfer_account_id"> & Partial<Pick<Rule, "priority">>, manual?: ManualAdoption) {
  const db = await database();

  return db.transaction(async tx => {
    const result = await tx.update(categorizationRules).set(details).where(eq(categorizationRules.id, id));

    if (result.rowsAffected === 0) {
      return false;
    }

    if (manual) {
      const adopted = await adoptManualAssignments(tx, {
        id,
        category_id: details.category_id
      }, await readRules(tx), manual);

      await applyRuleType(tx, {
        id,
        transaction_type: details.transaction_type,
        transfer_account_id: details.transfer_account_id
      }, adopted);
    }

    return true;
  });
}

export async function setRuleEnabled(id: string, enabled: boolean) {
  const db = await database();

  const result = await db.update(categorizationRules).set({
    enabled: enabled ? 1 : 0
  }).where(eq(categorizationRules.id, id));

  return result.rowsAffected > 0;
}

/** Manually categorized transactions with the text rules match. */
export async function findManualAssignments() {
  const db = await database();
  const scope = and(eq(accounts.environment, environment()), isNull(accounts.archived_at), eq(transactions.category_source, "manual"));

  return db.select({
    id: transactions.id,
    category_id: transactions.category_id,
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(scope);
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
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
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

/** Bookings whose type rules may set, with the text rules match and the rule that set their current type. */
export async function findRuleTypeableTransactions() {
  const db = await database();

  return db.select({
    id: transactions.id,
    amount_minor: transactions.amount_minor,
    type: transactions.type,
    type_rule_id: transactions.type_rule_id,
    type_transfer_account_id: transactions.type_transfer_account_id,
    transfer_detected: transactions.transfer_detected,
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(accounts.environment, environment()), isNull(accounts.archived_at), ruleTypeable));
}

/** Stores rule-decided types on bookings nobody corrected or linked meanwhile, then pairs transfers so rule-set transfers link to, or create, their counterparts in the same write transaction. */
export async function saveRuleTypes(entries: Pick<Transaction, "id" | "type" | "type_rule_id" | "type_transfer_account_id">[]) {
  const db = await database();

  await db.transaction(async tx => {
    // An account archived after the candidates were read stays read-only.
    const activeAccounts = tx.select({
      id: accounts.id
    }).from(accounts).where(isNull(accounts.archived_at));

    for (const entry of entries) {
      await tx.update(transactions).set({
        type: entry.type,
        type_rule_id: entry.type_rule_id,
        type_transfer_account_id: entry.type_transfer_account_id
      }).where(and(eq(transactions.id, entry.id), ruleTypeable, inArray(transactions.account_id, activeAccounts)));
    }

    await pairTransfers(tx, environment());
  });
}

/** Deletes the rule and, in the same write transaction, its references from the categories it assigned, which keep their category. */
export async function deleteRule(id: string) {
  const db = await database();

  return db.transaction(async tx => {
    const result = await tx.delete(categorizationRules).where(eq(categorizationRules.id, id));

    await tx.update(transactions).set({
      category_rule_id: null
    }).where(eq(transactions.category_rule_id, id));
    await tx.update(transactions).set({
      type_rule_id: null
    }).where(eq(transactions.type_rule_id, id));

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
