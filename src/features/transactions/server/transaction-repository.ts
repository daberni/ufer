import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { accounts, transactions } from "@/server/database/schema";
import type { CategorizedEntry } from "./transaction-entry";

export async function upsertTransactions(tx: DatabaseTransaction, accountId: string, entries: CategorizedEntry[]) {
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
      category_id: entry.categoryId
    }));

    await tx.insert(transactions).values(values).onConflictDoUpdate({
      target: [transactions.account_id, transactions.provider_reference],
      set: {
        booking_date: sql`excluded.booking_date`,
        amount_minor: sql`excluded.amount_minor`,
        currency: sql`excluded.currency`,
        counterparty: sql`excluded.counterparty`,
        description: sql`excluded.description`,
        category_id: sql`CASE WHEN ${transactions.category_source}='manual' THEN ${transactions.category_id} ELSE excluded.category_id END`
      }
    });
  }
}

export async function setTransactionCategory(id: string, categoryId: string | null) {
  const db = await database();
  const scopedAccounts = db.select({
    id: accounts.id
  }).from(accounts).where(eq(accounts.environment, environment()));
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
