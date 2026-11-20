import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, notExists } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, categorizationRules, transactionSplits, transactions } from "@/server/database/schema";
import type { Rule, RuleAssignment, RuleText } from "@/lib/rules";
import type { TransactionType } from "@/features/transactions/transaction-types";
import type { SplitPart } from "@/features/transactions/types";

/** The booking a split divides, as the split's validation needs it. */
export type SplitSubject = {
  amount_minor: number;
  currency: string;
  type: TransactionType;
};

/** One validated part, in the booking's minor units. */
export type SplitPartValues = {
  amount: number;
  categoryId: string | null;
  note: string;
};

/** Condition for bookings that are not split; rules never categorize a split booking, whose categories are its parts. */
export function notSplit(db: Pick<Awaited<ReturnType<typeof database>>, "select">) {
  return notExists(db.select({
    id: transactionSplits.id
  }).from(transactionSplits).where(eq(transactionSplits.transaction_id, transactions.id)));
}

async function scopedTransaction(id: string) {
  const db = await database();
  const scopedAccounts = db.select({
    id: accounts.id
  }).from(accounts).where(eq(accounts.environment, environment()));

  return {
    db,
    scope: and(eq(transactions.id, id), inArray(transactions.account_id, scopedAccounts))
  };
}

/**
 * Replaces a booking's parts with the ones `decide` returns for the booking as stored in the same write transaction, so the sum is checked against its current amount. A split booking's own category is cleared and marked manual, so rules leave it alone.
 * Resolves to undefined for a booking outside the current environment; an error thrown by `decide` stores nothing.
 */
export async function replaceSplit(id: string, decide: (subject: SplitSubject) => SplitPartValues[]) {
  const {
    db,
    scope
  } = await scopedTransaction(id);

  return db.transaction(async tx => {
    const subject = await tx.select({
      amount_minor: transactions.amount_minor,
      currency: transactions.currency,
      type: transactions.type
    }).from(transactions).where(scope).get();

    if (!subject) {
      return undefined;
    }

    const parts = decide(subject);

    await tx.delete(transactionSplits).where(eq(transactionSplits.transaction_id, id));
    await tx.insert(transactionSplits).values(parts.map((part, position) => ({
      id: randomUUID(),
      transaction_id: id,
      position,
      amount_minor: part.amount,
      category_id: part.categoryId,
      note: part.note
    })));
    await tx.update(transactions).set({
      category_id: null,
      category_source: "manual",
      category_rule_id: null
    }).where(eq(transactions.id, id));

    return parts;
  });
}

/**
 * Removes a booking's parts and returns it to automatic categorization, with the category and rule the stored rules assign its text. A booking without parts keeps its category.
 * Resolves to undefined for a booking outside the current environment.
 */
export async function removeSplit(id: string, assign: (rules: Rule[], text: RuleText) => RuleAssignment) {
  const {
    db,
    scope
  } = await scopedTransaction(id);

  return db.transaction(async tx => {
    const found = await tx.select({
      counterparty: transactions.counterparty,
      description: transactions.description,
      counterparty_override: transactions.counterparty_override,
      description_override: transactions.description_override
    }).from(transactions).where(scope).get();

    if (!found) {
      return undefined;
    }

    const removed = await tx.delete(transactionSplits).where(eq(transactionSplits.transaction_id, id));

    if (removed.rowsAffected > 0) {
      const rules = await tx.select().from(categorizationRules);
      const assignment = assign(rules, found);

      await tx.update(transactions).set({
        category_id: assignment.categoryId,
        category_source: "rule",
        category_rule_id: assignment.ruleId
      }).where(eq(transactions.id, id));
    }

    return {
      ok: true
    };
  });
}

/** Whether saving this type would leave a split booking with a type that is not split: only income and expenses count by category. Read inside the write that saves the type. */
export async function splitRefusesType(tx: DatabaseTransaction, id: string, type: TransactionType) {
  if (type === "income" || type === "expense") {
    return false;
  }

  const part = await tx.select({
    id: transactionSplits.id
  }).from(transactionSplits).where(eq(transactionSplits.transaction_id, id)).limit(1).get();

  return part !== undefined;
}

/** Whether a booking is split into parts. */
export async function isSplit(id: string) {
  const db = await database();
  const part = await db.select({
    id: transactionSplits.id
  }).from(transactionSplits).where(eq(transactionSplits.transaction_id, id)).limit(1).get();

  return part !== undefined;
}

/** The parts of these bookings in their order, by booking. */
export async function readSplitParts(transactionIds: string[]) {
  const parts = new Map<string, SplitPart[]>();

  if (transactionIds.length === 0) {
    return parts;
  }

  const db = await database();
  const rows = await db.select().from(transactionSplits).where(inArray(transactionSplits.transaction_id, transactionIds)).orderBy(asc(transactionSplits.transaction_id), asc(transactionSplits.position));

  for (const row of rows) {
    const list = parts.get(row.transaction_id) ?? [];

    list.push({
      id: row.id,
      amount_minor: row.amount_minor,
      category_id: row.category_id,
      note: row.note
    });
    parts.set(row.transaction_id, list);
  }

  return parts;
}
