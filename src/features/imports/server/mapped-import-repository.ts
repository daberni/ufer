import { keepBankOpeningBalanceFirst } from "@/features/transactions/server/opening-balance-repository";
import type { ImportType } from "../import-rows";
import { randomUUID } from "node:crypto";
import { and, between, eq, inArray, ne, notInArray, or, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, categories, transactionSplits, transactions } from "@/server/database/schema";
import type { AccountKind } from "@/features/accounts/account-kinds";
import { assertWritableAccount } from "@/features/transactions/server/booking-accounts";
import { manualEntryPrefix } from "@/lib/booking-references";
import { newCategoryColor } from "@/features/categorization/category-color-suggestions";
import { suggestCategoryIcon, type CategoryIconKey } from "@/features/categorization/category-icons";
import { createCategory } from "@/features/categorization/server/category-repository";
import { derivedTransactionType, type RuleTransactionType } from "@/lib/transaction-types";
import type { SplitPartValues } from "@/features/transactions/server/split-repository";
import { matchingWindow } from "@/lib/booking-matching";
import { findDuplicates } from "./duplicate-matching";
import { describeMatches, planRows, type Decision, type StoredBooking } from "./row-decisions";

const referenceChunkSize = 500;

const isTransfer = sql<boolean>`(${transactions.type} = 'transfer' OR ${transactions.transfer_id} IS NOT NULL)`.mapWith(value => Boolean(value));

/** A type a person or rule set, a linked transfer's, a balance booking's or a split booking's, which stays income or expense: an update from the file leaves it. */
const typeLocked = sql<boolean>`(${transactions.type_source} = 'manual' OR ${transactions.type_rule_id} IS NOT NULL OR ${transactions.transfer_id} IS NOT NULL OR ${transactions.type} IN ('opening_balance','adjustment') OR EXISTS (SELECT 1 FROM ${transactionSplits} WHERE "transaction_splits"."transaction_id" = "transactions"."id"))`.mapWith(value => Boolean(value));

/** The columns duplicate matching and the review compare. */
const storedBooking = {
  id: transactions.id,
  reference: transactions.provider_reference,
  date: transactions.date,
  bookingDate: transactions.booking_date,
  amount: transactions.amount_minor,
  counterparty: transactions.counterparty,
  description: transactions.description,
  transfer: isTransfer,
  type: transactions.type,
  typeLocked,
  payeeOverride: transactions.counterparty_override,
  descriptionOverride: transactions.description_override
};

export type MappedEntry = {
  reference: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  categoryId: string | null;
  categorySource: "rule" | "manual";
  /** The rule that decided a rule-sourced category. */
  categoryRuleId: string | null;
  /** The type the deciding rule sets; null leaves the automatic type. */
  ruleType: RuleTransactionType | null;
  typeRuleId: string | null;
  typeTransferAccountId: string | null;
  /** The type the file's type column states; null derives it from the amount. A transfer is saved as detected so pairing can link it, and an expense with a positive amount is a refund. */
  fileType: ImportType | null;
  /** When set, the booking is saved hidden: stored for duplicate matching but excluded from balances, reports and pairing. */
  hiddenAt: string | null;
  /** The parts of a split booking, saved with it; the booking itself then has no category. */
  parts: SplitPartValues[] | null;
};

export type NewImportAccount = {
  name: string;
  kind: AccountKind;
  currency: string;
};

/** A new account's opening balance: `current` is its balance today, so the booking is that amount minus its other transactions; `start` is booked as given. */
export type OpeningBalance = {
  id: string;
  kind: "current" | "start";
  amount: number;
  date: string;
};

/** A category a "create" choice asks for; rows refer to it by `id` until the save creates it. */
export type NewImportCategory = {
  id: string;
  name: string;
  /** The icon and color the person saw; without them the category gets the ones the category dialog would suggest for the name. */
  shown?: {
    color: string;
    icon: CategoryIconKey | null;
  };
};

/**
 * Creates a category for an import within the caller's write transaction, or returns the category that already has an equivalent name.
 * Resolves to the category's ID and whether this call inserted it.
 */
export async function createImportCategory(tx: DatabaseTransaction, category: NewImportCategory) {
  const icon = category.shown ? category.shown.icon : suggestCategoryIcon(category.name);
  const shownColor = category.shown?.color;

  return createCategory(tx, {
    id: category.id,
    name: category.name,
    icon,
    color: shownColor ?? (existing => newCategoryColor(category.name, icon, existing))
  });
}

/** A manual or bank-linked account. */
export async function findImportTarget(id: string) {
  const db = await database();

  return db.select({
    id: accounts.id,
    name: accounts.name,
    kind: accounts.kind,
    currency: accounts.currency,
    provider: accounts.provider,
    archived_at: accounts.archived_at
  }).from(accounts).where(eq(accounts.id, id)).get();
}

/** Rows that decide a new import account's opening balance: all but those the import itself saved hidden, which the shown balance never includes. */
const countedTowardOpening = sql`(${transactions.suppressed_at} IS NULL OR ${transactions.suppressed_at}<>${transactions.created_at})`;

/** The opening balance an import booked on its new account under one of the given IDs, with the sum of the account's other transactions. */
export async function findImportOpening(accountId: string, ids: string[]) {
  const db = await database();
  const opening = await db.select({
    id: transactions.id,
    date: transactions.date,
    amount: transactions.amount_minor
  }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.id, ids))).get();

  if (!opening) {
    return null;
  }

  // Rows a person hid later count here too: this sum identifies the import's stated balance, which they did not change. Rows hidden by the import never counted toward it.
  const others = await db.select({
    total: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), ne(transactions.id, opening.id), countedTowardOpening)).get();

  return {
    ...opening,
    others: others?.total ?? 0
  };
}

/** Bookings that imported rows could duplicate, hidden ones included so a later import does not add them again; balance corrections are never imported rows. */
function bookingsBetween(executor: Executor, accountId: string, from: string, to: string): Promise<StoredBooking[]> {
  // A bank booking may match on its value date or on the bank's booking date.
  const inWindow = or(between(transactions.date, from, to), between(transactions.booking_date, from, to));
  const scope = and(eq(transactions.account_id, accountId), inWindow, notInArray(transactions.type, ["opening_balance", "adjustment"]));

  return executor.select(storedBooking).from(transactions).where(scope);
}

export async function listCategoryNames() {
  const db = await database();

  return db.select({
    id: categories.id,
    name: categories.name
  }).from(categories);
}

type Executor = Pick<DatabaseTransaction, "select">;

async function classify(executor: Executor, accountId: string, entries: MappedEntry[], consumed: ReadonlySet<string>, decisions: ReadonlyMap<number, Decision>) {
  const window = entries.length === 0 ? undefined : matchingWindow(entries.map(entry => entry.date).sort());
  const nearby = window ? await bookingsBetween(executor, accountId, window.from, window.to) : [];
  // A row identified by an export ID may have moved further than the window since it was imported; its reference still identifies it.
  const sameReference = await bookingsWithReferences(executor, accountId, entries.map(entry => entry.reference));
  const nearbyReferences = new Set(nearby.map(booking => booking.reference));
  const existing = [...nearby, ...sameReference.filter(booking => !nearbyReferences.has(booking.reference))];

  const expected = new Map([...decisions].flatMap(([index, decision]) => decision.action !== "create" && decision.booking ? [[index, decision.booking] as const] : []));

  const created = new Set([...decisions].flatMap(([index, decision]) => decision.action === "create" ? [index] : []));

  return findDuplicates(entries, existing, consumed, expected, created);
}

async function bookingsWithReferences(executor: Executor, accountId: string, references: string[]) {
  const found: StoredBooking[] = [];

  for (let offset = 0; offset < references.length; offset += referenceChunkSize) {
    const chunk = references.slice(offset, offset + referenceChunkSize);

    found.push(...await executor.select(storedBooking).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, chunk))));
  }

  return found;
}

/** Classifies rows against the account's bookings and plans the person's decisions without writing anything. */
export async function checkMappedEntries(accountId: string, entries: MappedEntry[], consumed: ReadonlySet<string>, decisions: ReadonlyMap<number, Decision> = new Map()) {
  const found = await classify(await database(), accountId, entries, consumed, decisions);
  const plan = planRows(entries, found, decisions);

  return {
    duplicates: found.duplicates,
    possible: found.possible,
    matched: [...found.matched.filter(booking => !plan.released.has(booking.reference)), ...plan.adopted],
    ...matchesOf(entries, found),
    undecided: plan.undecided,
    updated: plan.updates.map(update => update.index),
    inserted: plan.inserts.length
  };
}

/** The rows of one target account in a confirmed batch. */
export type MappedAccountRows = {
  accountId: string;
  entries: MappedEntry[];
  newAccount: NewImportAccount | null;
  consumed?: ReadonlySet<string>;
  opening?: OpeningBalance | null;
  /** The person's decisions for matched and possibly duplicate rows, by index in `entries`. */
  decisions?: ReadonlyMap<number, Decision>;
};

/**
 * Saves a confirmed batch for all its target accounts in one write transaction, so a failure leaves none of its accounts, bookings or categories behind.
 * New categories are created in the same transaction, and only when a saved row uses one. Results are in the order of `accounts`.
 */
export async function saveMappedBatch(accountRows: MappedAccountRows[], newCategories: NewImportCategory[]) {
  const db = await database();

  return db.transaction(async tx => {
    const pending = new Map(newCategories.map(category => [category.id, category]));
    const resolved = new Map<string, string>();
    const createdCategories: string[] = [];
    const ensureCategories = async (entries: MappedEntry[]) => {
      const used = entries.flatMap(entry => [entry.categoryId, ...(entry.parts ?? []).map(part => part.categoryId)]);

      for (const id of new Set(used)) {
        const category = id === null ? undefined : pending.get(id);

        if (!category || resolved.has(category.id)) {
          continue;
        }

        const result = await createImportCategory(tx, category);

        resolved.set(category.id, result.id);

        // A category another request created meanwhile is used, not reported as new.
        if (result.created) {
          createdCategories.push(category.name);
        }
      }

      const categoryOf = (id: string | null) => id === null ? null : resolved.get(id) ?? id;

      return entries.map(entry => ({
        ...entry,
        categoryId: categoryOf(entry.categoryId),
        parts: entry.parts?.map(part => ({
          ...part,
          categoryId: categoryOf(part.categoryId)
        })) ?? null
      }));
    };
    const results = [];

    for (const rows of accountRows) {
      results.push(await saveAccountRows(tx, rows, ensureCategories));
    }

    return {
      results,
      createdCategories
    };
  });
}

/**
 * Classifies rows exactly like `checkMappedEntries`, but inside the write transaction, and inserts the new ones, so a bank sync between check and confirmation cannot cause duplicates and both report the same result on unchanged data.
 * Matched rows update only their booking's source fields as the person decided, so confirming again changes nothing and existing categories survive. Older bookings imported into a bank-linked account move its opening balance before them.
 */
async function saveAccountRows(tx: DatabaseTransaction, {
  accountId,
  entries,
  newAccount,
  consumed = new Set(),
  opening = null,
  decisions = new Map()
}: MappedAccountRows, ensureCategories: (entries: MappedEntry[]) => Promise<MappedEntry[]>) {
  if (newAccount) {
    // The ID is stable per import and source account, so a retried or later batch reuses the account. Its balance is the sum of its transactions, including any opening balance.
    await tx.insert(accounts).values({
      id: accountId,
      name: newAccount.name,
      kind: newAccount.kind,
      currency: newAccount.currency
    }).onConflictDoNothing();
  }

  await assertWritableAccount(tx, accountId);
  const found = await classify(tx, accountId, entries, consumed, decisions);
  const plan = planRows(entries, found, decisions);
  const fresh = await ensureCategories(plan.inserts.map(index => entries[index]));
  const dates = new Map(fresh.map(entry => [entry.reference, entry.date]));
  // Later batches of this import pass the saved rows back as consumed, so rows of the same file never match each other by content.
  const saved: typeof found.matched = [];
  let inserted = 0;
  const insertedIds: string[] = [];

  // Bound statement parameters for both local SQLite and remote libSQL deployments.
  for (let offset = 0; offset < fresh.length; offset += 50) {
    const values = fresh.slice(offset, offset + 50).map(entry => ({
      id: randomUUID(),
      account_id: accountId,
      provider_reference: entry.reference,
      date: entry.date,
      amount_minor: entry.amount,
      currency: entry.currency,
      counterparty: entry.counterparty,
      description: entry.description,
      category_id: entry.categoryId,
      category_source: entry.categorySource,
      category_rule_id: entry.categoryRuleId,
      // A rule's type wins over the file's type, as on syncs; a transfer marker restores Transfer when the rule stops deciding.
      type: entry.ruleType ?? entry.fileType ?? derivedTransactionType(entry.amount),
      type_rule_id: entry.typeRuleId,
      type_transfer_account_id: entry.typeTransferAccountId,
      transfer_detected: entry.fileType === "transfer" ? 1 : 0,
      // A row hidden by the import shares its creation time, which tells it apart from a booking a person hid later.
      ...(entry.hiddenAt ? {
        created_at: entry.hiddenAt,
        suppressed_at: entry.hiddenAt
      } : {})
    }));
    const rows = await tx.insert(transactions).values(values).onConflictDoNothing({
      target: [transactions.account_id, transactions.provider_reference]
    }).returning({
      id: transactions.id,
      reference: transactions.provider_reference
    });

    inserted += rows.length;
    insertedIds.push(...rows.map(row => row.id));
    saved.push(...rows.map(row => ({
      reference: row.reference,
      date: dates.get(row.reference) ?? ""
    })));
    await saveImportedParts(tx, rows, fresh);
  }

  for (const update of plan.updates) {
    await updateSourceFields(tx, accountId, update.reference, entries[update.index], update.changes.includes("type"));
  }

  // Older history imported into a bank-linked account was part of its opening balance.
  await keepBankOpeningBalanceFirst(tx, accountId, insertedIds.length ? inArray(transactions.id, insertedIds) : undefined);

  if (opening) {
    await saveOpeningBalance(tx, accountId, newAccount?.currency ?? entries[0]?.currency ?? "", opening);
  }

  return {
    duplicates: found.duplicates,
    possible: found.possible,
    matched: [...found.matched.filter(booking => !plan.released.has(booking.reference)), ...plan.adopted, ...saved],
    ...matchesOf(entries, found),
    undecided: plan.undecided,
    updated: plan.updates.map(update => update.index),
    inserted
  };
}

function matchesOf(entries: MappedEntry[], found: Parameters<typeof describeMatches>[1]) {
  const {
    described,
    bookings
  } = describeMatches(entries, found);

  return {
    matches: described,
    bookings
  };
}

/** Writes a matched row's payee and description, and its type when the file states one the booking may take, onto the source fields; overrides, category, splits and links are separate and stay. */
async function updateSourceFields(tx: DatabaseTransaction, accountId: string, reference: string, entry: MappedEntry, withType: boolean) {
  await tx.update(transactions).set({
    counterparty: entry.counterparty,
    description: entry.description,
    ...(withType && entry.fileType ? {
      type: entry.fileType,
      transfer_detected: entry.fileType === "transfer" ? 1 : 0
    } : {})
  }).where(and(eq(transactions.account_id, accountId), eq(transactions.provider_reference, reference)));
}

/** Saves the parts of the split bookings just inserted; a booking that already existed keeps whatever split it has, so importing again adds no parts. */
async function saveImportedParts(tx: DatabaseTransaction, inserted: {
  id: string;
  reference: string;
}[], entries: MappedEntry[]) {
  const partsByReference = new Map(entries.flatMap(entry => entry.parts ? [[entry.reference, entry.parts] as const] : []));
  const values = inserted.flatMap(row => (partsByReference.get(row.reference) ?? []).map((part, position) => ({
    id: randomUUID(),
    transaction_id: row.id,
    position,
    amount_minor: part.amount,
    category_id: part.categoryId,
    note: part.note
  })));

  // Bound statement parameters like the bookings themselves.
  for (let offset = 0; offset < values.length; offset += 100) {
    await tx.insert(transactionSplits).values(values.slice(offset, offset + 100));
  }
}

/** Books or updates a new import account's opening balance. Every confirmed batch recalculates it, so after the last batch a `current` balance equals the account balance today. */
async function saveOpeningBalance(tx: DatabaseTransaction, accountId: string, currency: string, opening: OpeningBalance) {
  const others = await tx.select({
    total: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), ne(transactions.id, opening.id), countedTowardOpening)).get();
  const amount = opening.kind === "current" ? opening.amount - (others?.total ?? 0) : opening.amount;
  const account = await tx.select({
    currency: accounts.currency
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  await tx.insert(transactions).values({
    id: opening.id,
    account_id: accountId,
    provider_reference: `${manualEntryPrefix}${opening.id}`,
    date: opening.date,
    amount_minor: amount,
    currency: account?.currency ?? currency,
    counterparty: "",
    description: "",
    category_id: null,
    category_source: "manual",
    type: "opening_balance",
    type_source: "manual"
  }).onConflictDoUpdate({
    target: transactions.id,
    set: {
      date: opening.date,
      amount_minor: amount
    }
  });
}
