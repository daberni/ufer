import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, categories, categorizationRules, transactionSplits, transactions } from "@/server/database/schema";
import { ValidationError } from "@/lib/errors";
import type { Rule, RuleAssignment, RuleText } from "@/lib/rules";
import type { TransactionType } from "@/features/transactions/transaction-types";
import type { SplitPart } from "@/features/transactions/types";
import { assertWritableAccount } from "@/features/accounts/server/writable-account";
import type { Entry } from "./transaction-entry";

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

/** SQL for bookings whose alias is not split. Every write that categorizes, retypes or links a booking requires it in its own statement or transaction: a split booking's categories are its parts and it stays income or expense. */
export function notSplitSql(alias: string) {
  return `NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=${alias}.id)`;
}

/** The same guard for typed queries on `transactions`. */
export const notSplit = sql`NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=${transactions.id})`;

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
 * Resolves to undefined for a booking outside the current environment; a booking on an archived account or an error thrown by `decide` stores nothing.
 */
export async function replaceSplit(id: string, decide: (subject: SplitSubject) => SplitPartValues[]) {
  const {
    db,
    scope
  } = await scopedTransaction(id);

  return db.transaction(async tx => {
    const subject = await tx.select({
      account_id: transactions.account_id,
      amount_minor: transactions.amount_minor,
      currency: transactions.currency,
      type: transactions.type
    }).from(transactions).where(scope).get();

    if (!subject) {
      return undefined;
    }

    await assertWritableAccount(tx, subject.account_id);

    const parts = decide(subject);
    const categoryIds = [...new Set(parts.map(part => part.categoryId).filter(categoryId => categoryId !== null))];

    // The service checked the categories before this transaction; one deleted since then must not fail the insert on its foreign key.
    if (categoryIds.length > 0) {
      const found = await tx.select({
        id: categories.id
      }).from(categories).where(inArray(categories.id, categoryIds));

      if (found.length !== categoryIds.length) {
        throw new ValidationError("Category does not exist.");
      }
    }

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
 * Removes a booking's parts and returns it to automatic categorization, with the category and rule the stored rules assign its text, and an automatic type to the one its current sign gives. A booking without parts keeps its category and type.
 * Resolves to undefined for a booking outside the current environment; a booking on an archived account is refused.
 */
export async function removeSplit(id: string, assign: (rules: Rule[], text: RuleText) => RuleAssignment) {
  const {
    db,
    scope
  } = await scopedTransaction(id);

  return db.transaction(async tx => {
    const found = await tx.select({
      account_id: transactions.account_id,
      counterparty: transactions.counterparty,
      description: transactions.description,
      counterparty_override: transactions.counterparty_override,
      description_override: transactions.description_override
    }).from(transactions).where(scope).get();

    if (!found) {
      return undefined;
    }

    await assertWritableAccount(tx, found.account_id);

    const removed = await tx.delete(transactionSplits).where(eq(transactionSplits.transaction_id, id));

    if (removed.rowsAffected > 0) {
      const rules = await tx.select().from(categorizationRules);
      const assignment = assign(rules, found);

      await tx.update(transactions).set({
        category_id: assignment.categoryId,
        category_source: "rule",
        category_rule_id: assignment.ruleId
      }).where(eq(transactions.id, id));
      // Syncs keep a split booking's type, so an automatic, unlinked one follows its current amount again. Deliveries' transfer signal is not stored, so only the sign is reconciled.
      await tx.update(transactions).set({
        type: sql`CASE WHEN ${transactions.amount_minor}>0 THEN 'income' ELSE 'expense' END`
      }).where(and(eq(transactions.id, id), eq(transactions.type_source, "auto"), isNull(transactions.transfer_id), inArray(transactions.type, ["income", "expense"])));
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
  }).from(transactionSplits).innerJoin(transactions, eq(transactions.id, transactionSplits.transaction_id)).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactionSplits.transaction_id, id), eq(accounts.environment, environment()))).limit(1).get();

  return part !== undefined;
}

/** Whether a booking of the current environment is split into parts. */
export async function isSplit(id: string) {
  const db = await database();
  const part = await db.select({
    id: transactionSplits.id
  }).from(transactionSplits).innerJoin(transactions, eq(transactions.id, transactionSplits.transaction_id)).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactionSplits.transaction_id, id), eq(accounts.environment, environment()))).limit(1).get();

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

/**
 * Removes the split of every booking among these entries whose delivered currency differs from the stored one, since its parts are amounts in the old currency. The bookings return to automatic categorization, so the same write assigns their rule category.
 */
export async function dropSplitsOnCurrencyChange(tx: DatabaseTransaction, accountId: string, entries: Pick<Entry, "reference" | "currency">[]) {
  const delivered = new Map(entries.map(entry => [entry.reference, entry.currency]));
  const stored = await tx.select({
    id: transactions.id,
    reference: transactions.provider_reference,
    currency: transactions.currency
  }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, [...delivered.keys()]), sql`NOT ${notSplit}`));
  const changed = stored.filter(row => delivered.get(row.reference) !== row.currency).map(row => row.id);

  if (changed.length === 0) {
    return;
  }

  await tx.delete(transactionSplits).where(inArray(transactionSplits.transaction_id, changed));
  await tx.update(transactions).set({
    category_source: "rule",
    category_rule_id: null
  }).where(inArray(transactions.id, changed));
}
