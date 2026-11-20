import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { and, between, eq, inArray, like, ne, notInArray, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, categories, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import type { AccountKind } from "@/features/accounts/account-kinds";
import { assertWritableAccount } from "@/features/accounts/server/writable-account";
import { manualEntryPrefix } from "@/features/transactions/server/transfer-repository";
import { insertCategory } from "@/features/categorization/server/category-repository";
import { defaultCategoryColor } from "@/features/categorization/category-colors";
import { sameCategoryName } from "@/lib/category-name";
import { derivedTransactionType } from "@/features/transactions/transaction-types";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";
import { duplicateDateToleranceDays, findDuplicates, mappedReferencePrefix, matchBooking, type ExistingBooking } from "./duplicate-matching";

const referenceChunkSize = 500;

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
  /** Marked as a transfer by the file; saved with an automatic transfer type so pairing can link it. */
  transfer: boolean;
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

/** Creates a category for an import, or returns the one that took the name concurrently. */
export async function createImportCategory(name: string) {
  const id = randomUUID();
  const result = await insertCategory(id, {
    name,
    color: defaultCategoryColor,
    icon: null
  });

  if (result === "saved") {
    return id;
  }

  const existing = (await listCategoryNames()).find(category => sameCategoryName(category.name, name));

  if (!existing) {
    throw new Error("The imported category could not be created.");
  }

  return existing.id;
}

/** A manual or bank-linked account of the current banking environment. */
export async function findImportTarget(id: string) {
  const db = await database();

  return db.select({
    id: accounts.id,
    name: accounts.name,
    kind: accounts.kind,
    currency: accounts.currency,
    provider: accounts.provider,
    archived_at: accounts.archived_at
  }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.environment, environment()))).get();
}

/** The opening balance an import booked on its new account under one of the given IDs, with the sum of the account's other transactions. */
export async function findImportOpening(accountId: string, ids: string[]) {
  const db = await database();
  const opening = await db.select({
    id: transactions.id,
    date: transactions.booking_date,
    amount: transactions.amount_minor
  }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.id, ids))).get();

  if (!opening) {
    return null;
  }

  // Hidden rows count here too: this sum identifies the import's stated balance, not the balance shown.
  const others = await db.select({
    total: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), ne(transactions.id, opening.id))).get();

  return {
    ...opening,
    others: others?.total ?? 0
  };
}

/** Bookings that imported rows could duplicate, hidden ones included so a later import does not add them again; balance corrections are never imported rows. */
function bookingsBetween(executor: Executor, accountId: string, from: string, to: string): Promise<ExistingBooking[]> {
  const scope = and(eq(transactions.account_id, accountId), between(transactions.booking_date, from, to), notInArray(transactions.type, ["opening_balance", "adjustment"]));

  return executor.select({
    reference: transactions.provider_reference,
    date: transactions.booking_date,
    amount: transactions.amount_minor,
    counterparty: transactions.counterparty,
    description: transactions.description
  }).from(transactions).where(scope);
}

export async function listCategoryNames() {
  const db = await database();

  return db.select({
    id: categories.id,
    name: categories.name
  }).from(categories);
}

type Executor = Pick<DatabaseTransaction, "select">;

async function classify(executor: Executor, accountId: string, entries: MappedEntry[], consumed: ReadonlySet<string>) {
  const dates = entries.map(entry => entry.date).sort();
  const nearby = entries.length === 0 ? [] : await bookingsBetween(executor, accountId, shiftDays(dates[0], -duplicateDateToleranceDays), shiftDays(dates[dates.length - 1], duplicateDateToleranceDays));
  // A row identified by an export ID may have moved further than the window since it was imported; its reference still identifies it.
  const sameReference = await bookingsWithReferences(executor, accountId, entries.map(entry => entry.reference));
  const nearbyReferences = new Set(nearby.map(booking => booking.reference));
  const existing = [...nearby, ...sameReference.filter(booking => !nearbyReferences.has(booking.reference))];

  return findDuplicates(entries, existing, consumed);
}

async function bookingsWithReferences(executor: Executor, accountId: string, references: string[]) {
  const found: ExistingBooking[] = [];

  for (let offset = 0; offset < references.length; offset += referenceChunkSize) {
    const chunk = references.slice(offset, offset + referenceChunkSize);

    found.push(...await executor.select({
      reference: transactions.provider_reference,
      date: transactions.booking_date,
      amount: transactions.amount_minor,
      counterparty: transactions.counterparty,
      description: transactions.description
    }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, chunk))));
  }

  return found;
}

/** Classifies rows against the account's bookings without writing anything. */
export async function checkMappedEntries(accountId: string, entries: MappedEntry[], consumed: ReadonlySet<string>) {
  const found = await classify(await database(), accountId, entries, consumed);

  return {
    ...found,
    inserted: entries.length - found.duplicates.size
  };
}

/**
 * Classifies rows exactly like `checkMappedEntries`, but inside the write transaction, and inserts the new ones, so a bank sync between check and confirmation cannot cause duplicates and both report the same result on unchanged data.
 * A row whose reference the account already holds is left untouched, so confirming again changes nothing and existing categories survive. Inserting bookings never writes a bank-linked account's provider balance.
 */
export async function saveMappedEntries(accountId: string, entries: MappedEntry[], newAccount: NewImportAccount | null, consumed: ReadonlySet<string> = new Set(), opening: OpeningBalance | null = null) {
  const db = await database();

  return db.transaction(async tx => {
    if (newAccount) {
      // The ID is stable per import and source account, so a retried or later batch reuses the account. Its balance is the sum of its transactions, including any opening balance.
      await tx.insert(accounts).values({
        id: accountId,
        environment: environment(),
        name: newAccount.name,
        institution: "CSV import",
        kind: newAccount.kind,
        currency: newAccount.currency
      }).onConflictDoNothing();
    }

    await assertWritableAccount(tx, accountId);
    const found = await classify(tx, accountId, entries, consumed);
    const fresh = entries.filter((_entry, index) => !found.duplicates.has(index));
    let inserted = 0;

    // Bound statement parameters for both local SQLite and remote libSQL deployments.
    for (let offset = 0; offset < fresh.length; offset += 50) {
      const values = fresh.slice(offset, offset + 50).map(entry => ({
        id: randomUUID(),
        account_id: accountId,
        provider_reference: entry.reference,
        booking_date: entry.date,
        amount_minor: entry.amount,
        currency: entry.currency,
        counterparty: entry.counterparty,
        description: entry.description,
        category_id: entry.categoryId,
        category_source: entry.categorySource,
        category_rule_id: entry.categoryRuleId,
        type: entry.transfer ? "transfer" as const : derivedTransactionType(entry.amount)
      }));
      const rows = await tx.insert(transactions).values(values).onConflictDoNothing({
        target: [transactions.account_id, transactions.provider_reference]
      }).returning({
        id: transactions.id
      });

      inserted += rows.length;
    }

    if (opening) {
      await saveOpeningBalance(tx, accountId, newAccount?.currency ?? entries[0]?.currency ?? "", opening);
    }

    return {
      ...found,
      inserted
    };
  });
}

/**
 * Lets a bank delivery take over rows a mapped CSV import saved for the same bookings, matched by the import's duplicate rule. The row gets the bank reference, so the following upsert updates it with the provider data instead of inserting a duplicate; the returned entries carry the row's category, so it survives that upsert.
 */
export async function adoptImportedRows(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[]) {
  if (entries.length === 0) {
    return entries;
  }

  const dates = entries.map(entry => entry.date).sort();
  const imported = await tx.select({
    id: transactions.id,
    reference: transactions.provider_reference,
    date: transactions.booking_date,
    amount: transactions.amount_minor,
    counterparty: transactions.counterparty,
    description: transactions.description,
    categoryId: transactions.category_id,
    categoryRuleId: transactions.category_rule_id
  }).from(transactions).where(and(eq(transactions.account_id, accountId), like(transactions.provider_reference, `${mappedReferencePrefix}%`), between(transactions.booking_date, shiftDays(dates[0], -duplicateDateToleranceDays), shiftDays(dates[dates.length - 1], duplicateDateToleranceDays))));

  if (imported.length === 0) {
    return entries;
  }

  const knownReferences = new Set<string | null>();

  // One bound parameter per reference; chunks stay below SQLite's variable limit for large syncs.
  for (let offset = 0; offset < entries.length; offset += referenceChunkSize) {
    const references = entries.slice(offset, offset + referenceChunkSize).map(entry => entry.reference);
    const known = await tx.select({
      reference: transactions.provider_reference
    }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, references)));

    for (const row of known) {
      knownReferences.add(row.reference);
    }
  }

  const used = new Set<string>();
  const adopted: CategorizedEntry[] = [];

  for (const entry of entries) {
    const match = knownReferences.has(entry.reference) ? -1 : matchBooking(entry, imported, index => !used.has(imported[index].id));
    // An ambiguous match inserts the bank booking rather than guessing which imported row it replaces.
    const row = typeof match === "number" && match >= 0 ? imported[match] : undefined;

    if (!row) {
      adopted.push(entry);
      continue;
    }

    used.add(row.id);
    // A repeated bank entry must not adopt a second imported row under the same reference.
    knownReferences.add(entry.reference);
    await tx.update(transactions).set({
      provider_reference: entry.reference
    }).where(eq(transactions.id, row.id));
    adopted.push({
      ...entry,
      categoryId: row.categoryId,
      categoryRuleId: row.categoryRuleId
    });
  }

  return adopted;
}

/** Books or updates a new import account's opening balance. Every confirmed batch recalculates it, so after the last batch a `current` balance equals the account balance today. */
async function saveOpeningBalance(tx: DatabaseTransaction, accountId: string, currency: string, opening: OpeningBalance) {
  const others = await tx.select({
    total: sql<number>`COALESCE(SUM(${transactions.amount_minor}),0)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), ne(transactions.id, opening.id))).get();
  const amount = opening.kind === "current" ? opening.amount - (others?.total ?? 0) : opening.amount;
  const account = await tx.select({
    currency: accounts.currency
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  await tx.insert(transactions).values({
    id: opening.id,
    account_id: accountId,
    provider_reference: `${manualEntryPrefix}${opening.id}`,
    booking_date: opening.date,
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
      booking_date: opening.date,
      amount_minor: amount
    }
  });
}

function shiftDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({
    days
  }).toString();
}
