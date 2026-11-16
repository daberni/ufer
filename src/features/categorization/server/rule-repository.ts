import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import type { Rule } from "@/lib/rules";
import type { Transaction } from "@/server/database/models";
import { accounts, categorizationRules, transactions } from "@/server/database/schema";

export async function listRules() {
  const db = await database();

  return db.select().from(categorizationRules);
}

export async function insertRule(input: Omit<Rule, "id" | "enabled"> & {
  enabled: boolean;
}) {
  const db = await database();

  await db.insert(categorizationRules).values({
    ...input,
    id: randomUUID(),
    enabled: input.enabled ? 1 : 0
  });
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
  const scope = and(eq(accounts.environment, environment()), eq(transactions.category_source, "rule"), or(isNull(transactions.category_id), ne(transactions.category_id, "transfer")));

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
