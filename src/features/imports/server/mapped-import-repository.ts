import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { and, between, eq, inArray, like, notInArray } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, categories, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { pairTransfers } from "@/features/transactions/server/transfer-repository";
import { derivedTransactionType } from "@/features/transactions/transaction-types";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";
import { duplicateDateToleranceDays, mappedReferencePrefix, matchBooking, type ExistingBooking } from "./duplicate-matching";

export type MappedEntry = {
  reference: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  categoryId: string | null;
  categorySource: "rule" | "manual";
};

export type NewImportAccount = {
  name: string;
  currency: string;
};

/** A manual or bank-linked account of the current banking environment. */
export async function findImportTarget(id: string) {
  const db = await database();

  return db.select({
    id: accounts.id,
    currency: accounts.currency,
    provider: accounts.provider
  }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.environment, environment()))).get();
}

/** Bookings that imported rows could duplicate; balance corrections are never imported rows. */
export async function readBookingsBetween(accountId: string, from: string, to: string): Promise<ExistingBooking[]> {
  const db = await database();
  const scope = and(eq(transactions.account_id, accountId), between(transactions.booking_date, from, to), notInArray(transactions.type, ["opening_balance", "adjustment"]));

  return db.select({
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

/**
 * Inserts new rows only. A row whose reference the account already holds is left untouched, so confirming an import again changes nothing and existing categories survive.
 * Inserting bookings never writes a bank-linked account's provider balance.
 */
export async function insertMappedEntries(accountId: string, entries: MappedEntry[], newAccount: NewImportAccount | null) {
  const db = await database();
  let inserted = 0;

  await db.transaction(async tx => {
    if (newAccount) {
      // The ID is stable per import and source account, so a retried or later batch reuses the account. It has no opening balance: its balance is the sum of the imported rows.
      await tx.insert(accounts).values({
        id: accountId,
        environment: environment(),
        name: newAccount.name,
        institution: "CSV import",
        kind: "checking",
        currency: newAccount.currency
      }).onConflictDoNothing();
    }

    // Bound statement parameters for both local SQLite and remote libSQL deployments.
    for (let offset = 0; offset < entries.length; offset += 50) {
      const values = entries.slice(offset, offset + 50).map(entry => ({
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
        type: derivedTransactionType(entry.amount)
      }));
      const rows = await tx.insert(transactions).values(values).onConflictDoNothing({
        target: [transactions.account_id, transactions.provider_reference]
      }).returning({
        id: transactions.id
      });

      inserted += rows.length;
    }

    await pairTransfers(tx, environment());
  });

  return inserted;
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
    categoryId: transactions.category_id
  }).from(transactions).where(and(eq(transactions.account_id, accountId), like(transactions.provider_reference, `${mappedReferencePrefix}%`), between(transactions.booking_date, shiftDays(dates[0], -duplicateDateToleranceDays), shiftDays(dates[dates.length - 1], duplicateDateToleranceDays))));

  if (imported.length === 0) {
    return entries;
  }

  const known = await tx.select({
    reference: transactions.provider_reference
  }).from(transactions).where(and(eq(transactions.account_id, accountId), inArray(transactions.provider_reference, entries.map(entry => entry.reference))));
  const knownReferences = new Set(known.map(row => row.reference));
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
    await tx.update(transactions).set({
      provider_reference: entry.reference
    }).where(eq(transactions.id, row.id));
    adopted.push({
      ...entry,
      categoryId: row.categoryId
    });
  }

  return adopted;
}

function shiftDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({
    days
  }).toString();
}
