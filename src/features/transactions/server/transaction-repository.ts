import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, transactions } from "@/server/database/schema";
import { derivedTransactionType } from "@/features/transactions/transaction-types";
import type { CategorizedEntry, ProviderDetails } from "./transaction-entry";
import { followImportedCorrections, releaseOutdatedLinks } from "./transfer-repository";

function providerColumns(provider: ProviderDetails = {}) {
  return {
    instructed_amount_minor: provider.instructedAmount ?? null,
    instructed_currency: provider.instructedCurrency ?? null,
    provider_payload: provider.payload ?? null
  };
}

/**
 * Inserts new entries and updates existing ones. `createdAt` replaces the database clock only for inserted rows; updates keep the original `created_at`.
 * Updates replace the provider data with the latest delivery for every row; only rule-sourced categories are recalculated.
 * The type is recalculated only while nobody corrected it, the booking is not linked and it is not a transfer: no source reports that a booking is not a transfer, so a delivery without a transfer signal never downgrades one. A booking entered in Ufer follows the corrected date and amount of the imported booking it is linked with; other links whose corrected amount or currency no longer pairs are released first.
 */
export async function upsertTransactions(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[], createdAt?: string) {
  // Bound statement parameters for both local SQLite and remote libSQL deployments.
  for (let offset = 0; offset < entries.length; offset += 50) {
    const chunk = entries.slice(offset, offset + 50);

    await followImportedCorrections(tx, accountId, chunk);
    await releaseOutdatedLinks(tx, accountId, chunk);

    const values = chunk.map(entry => ({
      id: randomUUID(),
      account_id: accountId,
      provider_reference: entry.reference,
      booking_date: entry.date,
      amount_minor: entry.amount,
      currency: entry.currency,
      counterparty: entry.counterparty,
      description: entry.description,
      category_id: entry.categoryId,
      type: derivedTransactionType(entry.amount, entry.transfer),
      created_at: createdAt,
      ...providerColumns(entry.provider)
    }));

    await tx.insert(transactions).values(values).onConflictDoUpdate({
      target: [transactions.account_id, transactions.provider_reference],
      set: {
        booking_date: sql`excluded.booking_date`,
        amount_minor: sql`excluded.amount_minor`,
        currency: sql`excluded.currency`,
        counterparty: sql`excluded.counterparty`,
        description: sql`excluded.description`,
        instructed_amount_minor: sql`excluded.instructed_amount_minor`,
        instructed_currency: sql`excluded.instructed_currency`,
        provider_payload: sql`excluded.provider_payload`,
        category_id: sql`CASE WHEN ${transactions.category_source}='manual' THEN ${transactions.category_id} ELSE excluded.category_id END`,
        type: sql`CASE WHEN ${transactions.type_source}='manual' OR ${transactions.transfer_id} IS NOT NULL OR ${transactions.type}='transfer' THEN ${transactions.type} ELSE excluded.type END`
      }
    });
  }
}

/** Assigns a category manually; a booking on an archived account is refused because it is read-only. */
export async function setTransactionCategory(id: string, categoryId: string | null) {
  const db = await database();
  const owner = await db.select({
    archived_at: accounts.archived_at
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(eq(transactions.id, id), eq(accounts.environment, environment()))).get();

  if (owner?.archived_at) {
    return "archived_account" as const;
  }

  const scopedAccounts = db.select({
    id: accounts.id
  }).from(accounts).where(and(eq(accounts.environment, environment()), isNull(accounts.archived_at)));
  const scope = and(eq(transactions.id, id), inArray(transactions.account_id, scopedAccounts));
  const [assignment] = await db.update(transactions).set({
    category_id: categoryId,
    category_source: "manual"
  }).where(scope).returning({
    id: transactions.id,
    category_id: transactions.category_id,
    category_source: transactions.category_source
  });

  return assignment;
}
