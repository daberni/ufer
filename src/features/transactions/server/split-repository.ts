import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, categories, categorizationRules, transactionSplits, transactions } from "@/server/database/schema";
import { ValidationError } from "@/lib/errors";
import type { Rule, RuleAssignment, RuleText } from "@/lib/rules";
import type { TransactionType } from "@/lib/transaction-types";
import type { SplitPart } from "@/features/transactions/types";
import type { Entry } from "./transaction-entry";
import { pairTransfers } from "./transfer-pairing-repository";

/** A split change saved in the same write as a booking's details: remove the parts and return the booking to its rules, or replace them with the parts the decision validates against the booking as saved. */
export type SplitChange = {
  remove: (rules: Rule[], text: RuleText) => RuleAssignment;
} | {
  replace: (subject: SplitSubject) => SplitPartValues[];
};

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

/** Condition for a booking that is not split, on `transactions` or an alias of it. Every write that categorizes, retypes or links a booking requires it in its own statement or transaction: a split booking's categories are its parts and it stays income or expense. */
export function notSplitBooking(booking: {
  id: AnyColumn
}) {
  return sql`NOT EXISTS (SELECT 1 FROM ${transactionSplits} WHERE ${transactionSplits.transaction_id}=${booking.id})`;
}

/** The guard for queries on `transactions` itself. */
export const notSplit = notSplitBooking(transactions);

async function scopedTransaction(id: string) {
  const db = await database();
  const scopedAccounts = db.select({
    id: accounts.id
  }).from(accounts);

  return {
    db,
    scope: and(eq(transactions.id, id), inArray(transactions.account_id, scopedAccounts))
  };
}

/**
 * Replaces a booking's parts with the ones `decide` returns for the booking as stored in the same write transaction, so the sum is checked against its current amount. A split booking's own category is cleared and marked manual, so rules leave it alone.
 * Resolves to undefined for an unknown booking; an error thrown by `decide` stores nothing. Archiving freezes balances, not categories, so bookings on archived accounts can be split.
 */
export async function replaceSplit(id: string, decide: (subject: SplitSubject) => SplitPartValues[]) {
  const {
    db,
    scope
  } = await scopedTransaction(id);

  return db.transaction(async tx => {
    const subject = await tx.select({
      account_id: transactions.account_id
    }).from(transactions).where(scope).get();

    if (!subject) {
      return undefined;
    }

    return writeSplit(tx, id, decide);
  });
}

/** Replaces a booking's parts inside the caller's write transaction with the ones `decide` returns for the booking as stored there; an error thrown by `decide` rolls the write back. */
export async function writeSplit(tx: DatabaseTransaction, id: string, decide: (subject: SplitSubject) => SplitPartValues[]) {
  const subject = await tx.select({
    amount_minor: transactions.amount_minor,
    currency: transactions.currency,
    type: transactions.type
  }).from(transactions).where(eq(transactions.id, id)).get();

  if (!subject) {
    throw new Error("The booking to split was not found in its write transaction.");
  }

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
}

/** Whether a split booking's parts still add up to its amount; a booking without parts matches. Read inside the write that changes the amount. */
export async function splitMatchesAmount(tx: DatabaseTransaction, id: string) {
  const split = await tx.select({
    count: sql<number>`COUNT(*)`.mapWith(Number),
    total: sql<number>`COALESCE(SUM(${transactionSplits.amount_minor}),0)`.mapWith(Number)
  }).from(transactionSplits).where(eq(transactionSplits.transaction_id, id)).get();

  if (!split || split.count === 0) {
    return true;
  }

  const booking = await tx.select({
    amount_minor: transactions.amount_minor
  }).from(transactions).where(eq(transactions.id, id)).get();

  return booking?.amount_minor === split.total;
}

/**
 * Removes a booking's parts and returns it to automatic categorization, with the category and rule the stored rules assign its text, and an automatic type to the one its current sign gives. A booking without parts keeps its category and type.
 * Resolves to undefined for an unknown booking; a booking on an archived account keeps its type.
 */
export async function removeSplit(id: string, assign: (rules: Rule[], text: RuleText) => RuleAssignment) {
  const {
    db,
    scope
  } = await scopedTransaction(id);

  return db.transaction(async tx => {
    const found = await tx.select({
      account_id: transactions.account_id
    }).from(transactions).where(scope).get();

    if (!found) {
      return undefined;
    }

    if (await dissolveSplit(tx, id, assign)) {
      // A rule may have made the former split a transfer, which links to, or creates, its counterpart like any rule-set transfer.
      await pairTransfers(tx);
    }

    return {
      ok: true
    };
  });
}

/** Removes a booking's parts inside the caller's write transaction and returns it to what the stored rules decide for its text: category, and for an automatic, unlinked booking the rule's type and transfer account or else the derived type. Resolves to whether the booking was split. */
export async function dissolveSplit(tx: DatabaseTransaction, id: string, assign: (rules: Rule[], text: RuleText) => RuleAssignment) {
  const removed = await tx.delete(transactionSplits).where(eq(transactionSplits.transaction_id, id));

  if (removed.rowsAffected === 0) {
    return false;
  }

  await assignRuleDecision(tx, id, assign);

  return true;
}

/**
 * Assigns the category and rule the stored rules decide for the booking's current text, including its overrides. An automatic, unlinked booking also takes the deciding rule's type and transfer account, or without one the derived type: Transfer when its source reported one, otherwise its sign. Syncs keep a split booking's type, so this reconciles it.
 */
export async function assignRuleDecision(tx: DatabaseTransaction, id: string, assign: (rules: Rule[], text: RuleText) => RuleAssignment) {
  const text = await tx.select({
    counterparty: transactions.counterparty,
    description: transactions.description,
    counterparty_override: transactions.counterparty_override,
    description_override: transactions.description_override
  }).from(transactions).where(eq(transactions.id, id)).get();
  const rules = await tx.select().from(categorizationRules);
  const assignment = assign(rules, text ?? {
    counterparty: "",
    description: ""
  });

  await tx.update(transactions).set({
    category_id: assignment.categoryId,
    category_source: "rule",
    category_rule_id: assignment.ruleId
  }).where(eq(transactions.id, id));

  // Archiving freezes the type, so a booking on an archived account takes only the category.
  const activeAccounts = tx.select({
    id: accounts.id
  }).from(accounts).where(isNull(accounts.archived_at));
  const automatic = and(eq(transactions.id, id), eq(transactions.type_source, "auto"), isNull(transactions.transfer_id), notSplit, inArray(transactions.account_id, activeAccounts));

  if (assignment.type) {
    await tx.update(transactions).set({
      type: assignment.type,
      type_rule_id: assignment.ruleId,
      type_transfer_account_id: assignment.transferAccountId
    }).where(automatic);

    return;
  }

  await tx.update(transactions).set({
    type: sql`CASE WHEN ${transactions.transfer_detected}=1 THEN 'transfer' WHEN ${transactions.amount_minor}>0 THEN 'income' ELSE 'expense' END`,
    type_rule_id: null,
    type_transfer_account_id: null
  }).where(and(automatic, inArray(transactions.type, ["income", "expense", "transfer"])));
}

/** Whether saving this type would leave a split booking with a type that is not split: only income and expenses count by category. Read inside the write that saves the type. */
export async function splitRefusesType(tx: DatabaseTransaction, id: string, type: TransactionType) {
  if (type === "income" || type === "expense") {
    return false;
  }

  const part = await tx.select({
    id: transactionSplits.id
  }).from(transactionSplits).innerJoin(transactions, eq(transactions.id, transactionSplits.transaction_id)).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(transactionSplits.transaction_id, id)).limit(1).get();

  return part !== undefined;
}

/** Whether a booking is split into parts. */
export async function isSplit(id: string) {
  const db = await database();
  const part = await db.select({
    id: transactionSplits.id
  }).from(transactionSplits).innerJoin(transactions, eq(transactions.id, transactionSplits.transaction_id)).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(transactionSplits.transaction_id, id)).limit(1).get();

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
