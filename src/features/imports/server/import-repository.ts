import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import { pairTransfers } from "@/features/transactions/server/transfer-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";

export async function saveImportedTransactions(accountId: string, entries: CategorizedEntry[]) {
  const db = await database();

  await db.transaction(async tx => {
    await upsertTransactions(tx, accountId, entries);
    await pairTransfers(tx, environment());
  });
}

export async function saveImportedValuations(accountId: string, entries: {
  date: string;
  amount: number;
}[]) {
  const db = await database();
  const newest = entries[entries.length - 1];
  const scope = and(eq(accounts.id, accountId), eq(accounts.environment, environment()), or(isNull(accounts.balance_date), lte(accounts.balance_date, newest.date)));

  await db.transaction(async tx => {
    // Bound statement parameters for both local SQLite and remote libSQL deployments.
    for (let offset = 0; offset < entries.length; offset += 50) {
      const values = entries.slice(offset, offset + 50).map(entry => ({
        id: randomUUID(),
        account_id: accountId,
        observed_at: entry.date,
        amount_minor: entry.amount,
        source: "csv" as const
      }));

      await tx.insert(balanceSnapshots).values(values).onConflictDoUpdate({
        target: [balanceSnapshots.account_id, balanceSnapshots.observed_at],
        set: {
          amount_minor: sql`excluded.amount_minor`,
          source: sql`excluded.source`
        }
      });
    }

    await tx.update(accounts).set({
      balance_minor: newest.amount,
      balance_date: newest.date
    }).where(scope);
  });
}
