import { and, eq, inArray, isNull, asc, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import type { Transaction } from "@/server/database/models";
import { accounts, transactions } from "@/server/database/schema";
import { pairTransfers } from "./transfer-pairing-repository";
import { notSplit } from "./split-repository";
import { ruleTypeable } from "./rule-typeability";

// Bounds the bound parameters of each update for both local SQLite and remote libSQL deployments.
const assignmentChunkSize = 500;

/** Reads with the application connection, or inside a write transaction. */
type Reader = Pick<DatabaseTransaction, "select">;

const ruleText = {
  id: transactions.id,
  counterparty: transactions.counterparty,
  description: transactions.description,
  counterparty_override: transactions.counterparty_override,
  description_override: transactions.description_override
};

function chunks(ids: string[]) {
  const result: string[][] = [];

  for (let offset = 0; offset < ids.length; offset += assignmentChunkSize) {
    result.push(ids.slice(offset, offset + assignmentChunkSize));
  }

  return result;
}

/** Runs a rule use case in one write transaction; rule and booking writes take the provided transaction. */
export async function withRuleTransaction<Result>(work: (tx: DatabaseTransaction) => Promise<Result>) {
  const db = await database();

  return db.transaction(work);
}

/** Runs reads with the application connection outside a write transaction. */
export async function withRuleReader<Result>(work: (reader: Reader) => Promise<Result>) {
  return work(await database());
}

// Archiving freezes bookkeeping but not categorization, so rules categorize bookings on archived accounts without changing their type.
function activeAccounts(tx: DatabaseTransaction) {
  return tx.select({
    id: accounts.id
  }).from(accounts).where(isNull(accounts.archived_at));
}

const manualScope = and(eq(transactions.category_source, "manual"), notSplit);

/** Manually categorized, unsplit bookings with the text rules match. */
export function readManualCandidates(tx: DatabaseTransaction) {
  return tx.select(ruleText).from(transactions).where(manualScope);
}

/** Returns the given manual assignments to automatic categorization with the rule's category and a reference to the rule. */
export async function adoptManualAssignments(tx: DatabaseTransaction, rule: {
  id: string;
  category_id: string
}, ids: string[]) {
  for (const chunk of chunks(ids)) {
    await tx.update(transactions).set({
      category_id: rule.category_id,
      category_source: "rule",
      category_rule_id: rule.id
    }).where(and(inArray(transactions.id, chunk), eq(transactions.category_source, "manual")));
  }
}

function sourceScope(transactionId: string, categoryId: string) {
  return and(eq(transactions.id, transactionId), eq(transactions.category_source, "manual"), eq(transactions.category_id, categoryId));
}

/** The transaction a rule is created from, while it is still manually categorized with the rule's category. */
export function readSourceCandidates(tx: DatabaseTransaction, transactionId: string, categoryId: string) {
  return tx.select(ruleText).from(transactions).where(sourceScope(transactionId, categoryId));
}

/** Hands the transaction a rule was created from to that rule; it keeps its category. */
export async function adoptSourceTransaction(tx: DatabaseTransaction, rule: {
  id: string;
  category_id: string
}, transactionId: string) {
  await tx.update(transactions).set({
    category_source: "rule",
    category_rule_id: rule.id
  }).where(sourceScope(transactionId, rule.category_id));
}

/** Uncategorized bookings rules may categorize. */
export function readUncategorizedCandidates(tx: DatabaseTransaction) {
  return tx.select(ruleText).from(transactions).where(and(eq(transactions.category_source, "rule"), isNull(transactions.category_id)));
}

/** Gives the bookings the rule's category; resolves to the number of categorized bookings. */
export async function categorizeByRule(tx: DatabaseTransaction, rule: {
  id: string;
  category_id: string
}, ids: string[]) {
  let categorized = 0;

  for (const chunk of chunks(ids)) {
    const result = await tx.update(transactions).set({
      category_id: rule.category_id,
      category_rule_id: rule.id
    }).where(inArray(transactions.id, chunk));

    categorized += result.rowsAffected;
  }

  return categorized;
}

/** The given bookings whose type a rule may set, on active accounts. */
export async function readTypeableBookings(tx: DatabaseTransaction, ids: string[]) {
  const found = [];

  for (const chunk of chunks(ids)) {
    found.push(...await tx.select({
      id: transactions.id,
      amount_minor: transactions.amount_minor,
      type_rule_id: transactions.type_rule_id,
      transfer_detected: transactions.transfer_detected
    }).from(transactions).where(and(inArray(transactions.id, chunk), ruleTypeable, inArray(transactions.account_id, activeAccounts(tx)))));
  }

  return found;
}

type RuleType = Pick<Transaction, "id" | "type" | "type_rule_id" | "type_transfer_account_id">;

/** Stores rule-decided types on bookings nobody corrected or linked and whose account is active, then pairs transfers so rule-set transfers link to, or create, their counterparts. */
export async function storeRuleTypes(tx: DatabaseTransaction, entries: RuleType[]) {
  for (const entry of entries) {
    await tx.update(transactions).set({
      type: entry.type,
      type_rule_id: entry.type_rule_id,
      type_transfer_account_id: entry.type_transfer_account_id
    }).where(and(eq(transactions.id, entry.id), ruleTypeable, inArray(transactions.account_id, activeAccounts(tx))));
  }

  await pairTransfers(tx);
}

/** Stores rule-decided types in their own write transaction; an account archived after the candidates were read keeps its types. */
export async function saveRuleTypes(entries: RuleType[]) {
  const db = await database();

  await db.transaction(tx => storeRuleTypes(tx, entries));
}

/** Removes a deleted rule's references; the bookings keep their category and type. */
export async function clearRuleReferences(tx: DatabaseTransaction, ruleId: string) {
  await tx.update(transactions).set({
    category_rule_id: null
  }).where(eq(transactions.category_rule_id, ruleId));
  await tx.update(transactions).set({
    type_rule_id: null
  }).where(eq(transactions.type_rule_id, ruleId));
}

/** Manually categorized transactions with the text rules match. */
export async function findManualAssignments(reader: Reader) {
  return reader.select({
    ...ruleText,
    date: transactions.date,
    category_id: transactions.category_id
  }).from(transactions).where(manualScope);
}

/** Rule-categorized bookings, archived accounts included, since archiving does not freeze categories. */
export async function findUncorrectedTransactions(reader: Reader) {
  return reader.select({
    ...ruleText,
    date: transactions.date,
    category_id: transactions.category_id,
    category_rule_id: transactions.category_rule_id
  }).from(transactions).where(eq(transactions.category_source, "rule"));
}

/** The bookings a rule preview lists, with the payee a person sees. */
export async function findPreviewedTransactions(ids: string[]) {
  if (ids.length === 0) {
    return [];
  }

  const db = await database();

  return db.select({
    id: transactions.id,
    date: transactions.date,
    amount_minor: transactions.amount_minor,
    currency: transactions.currency,
    payee: sql<string>`coalesce(${transactions.counterparty_override}, ${transactions.counterparty})`,
    description: sql<string>`coalesce(${transactions.description_override}, ${transactions.description})`,
    category_id: transactions.category_id,
    category_source: transactions.category_source
  }).from(transactions).where(inArray(transactions.id, ids)).orderBy(sql`${transactions.date} desc`, asc(transactions.id));
}

export type PreviewedTransaction = Awaited<ReturnType<typeof findPreviewedTransactions>>[number];

/** Stores re-applied categories on bookings that are still rule-categorized. */
export async function storeRuleAssignments(tx: DatabaseTransaction, entries: Pick<Transaction, "id" | "category_id" | "category_rule_id">[]) {
  for (const entry of entries) {
    await tx.update(transactions).set({
      category_id: entry.category_id,
      category_rule_id: entry.category_rule_id
    }).where(and(eq(transactions.id, entry.id), eq(transactions.category_source, "rule")));
  }
}

/** Bookings whose type rules may set, with the text rules match and the rule that set their current type. */
export async function findRuleTypeableTransactions(tx: DatabaseTransaction) {
  return tx.select({
    ...ruleText,
    amount_minor: transactions.amount_minor,
    type: transactions.type,
    type_rule_id: transactions.type_rule_id,
    type_transfer_account_id: transactions.type_transfer_account_id,
    transfer_detected: transactions.transfer_detected
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(isNull(accounts.archived_at), ruleTypeable));
}
