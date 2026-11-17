import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import type { Rule } from "@/lib/rules";
import type { Transaction } from "@/server/database/models";
import { accounts, categorizationRules, transactions } from "@/server/database/schema";

/** Rules in creation order, which decides between rules of the same priority. */
export async function listRules() {
  const db = await database();

  return db.select().from(categorizationRules).orderBy(ruleCreationOrder);
}

// The table has no creation timestamp; SQLite gives a new row a larger rowid than every stored row. The rowid is not a stable key: VACUUM or a table
// rebuild can renumber it and so reorder rules of equal priority.
export const ruleCreationOrder = sql`${categorizationRules}.rowid`;

export type NewRule = Omit<Rule, "enabled"> & {
  enabled: boolean;
};

// Bounds the bound parameters of each update for both local SQLite and remote libSQL deployments.
const assignmentChunkSize = 500;

type RuleCandidate = Pick<Transaction, "id" | "counterparty" | "description">;

export type SelectRuleAssignments = (rules: Rule[], entries: RuleCandidate[]) => string[];

/** Reads the matching inputs and stores the rule and its optional assignments in one write transaction. */
export async function insertRule(rule: NewRule, selectAssignments?: SelectRuleAssignments) {
  const db = await database();

  return db.transaction(async tx => {
    await tx.insert(categorizationRules).values({
      ...rule,
      enabled: rule.enabled ? 1 : 0
    });

    if (!selectAssignments) {
      return 0;
    }

    const rules = await tx.select().from(categorizationRules).orderBy(ruleCreationOrder);
    const scope = and(eq(accounts.environment, environment()), eq(transactions.category_source, "rule"), isNull(transactions.category_id));
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
        category_id: rule.category_id
      }).where(inArray(transactions.id, chunk));

      categorized += result.rowsAffected;
    }

    return categorized;
  });
}

export async function updateRule(id: string, details: Pick<Rule, "name" | "pattern" | "mode" | "category_id" | "priority">) {
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
  const scope = and(eq(accounts.environment, environment()), eq(transactions.category_source, "rule"));

  return db.select({
    id: transactions.id,
    category_id: transactions.category_id,
    counterparty: transactions.counterparty,
    description: transactions.description
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(scope);
}

export async function saveRuleAssignments(entries: Pick<Transaction, "id" | "category_id">[]) {
  const db = await database();
  const [first, ...rest] = entries.map(entry => db.update(transactions).set({
    category_id: entry.category_id
  }).where(and(eq(transactions.id, entry.id), eq(transactions.category_source, "rule"))));

  if (first) {
    await db.batch([first, ...rest]);
  }

}
