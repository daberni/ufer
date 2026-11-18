import { randomUUID } from "node:crypto";
import { and, between, eq, notInArray } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, categories, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { pairTransfers } from "@/features/transactions/server/transfer-repository";
import { derivedTransactionType } from "@/features/transactions/transaction-types";
import type { AccountKind } from "@/features/accounts/account-kinds";
import type { ExistingBooking } from "./duplicate-matching";

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

/** Creates a manual account without an opening balance: its balance is the sum of the rows imported into it. */
export async function insertImportAccount(input: {
  name: string;
  institution: string;
  kind: AccountKind;
  currency: string;
}) {
  const db = await database();
  const id = randomUUID();

  await db.insert(accounts).values({
    id,
    environment: environment(),
    ...input
  });

  return {
    id
  };
}

/**
 * Inserts new rows only. A row whose reference the account already holds is left untouched, so confirming an import again changes nothing and existing categories survive.
 * Inserting bookings never writes a bank-linked account's provider balance.
 */
export async function insertMappedEntries(accountId: string, entries: MappedEntry[]) {
  const db = await database();
  let inserted = 0;

  await db.transaction(async tx => {
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
