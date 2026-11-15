import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { upsertTransactions } from "@/features/transactions/server/transaction-repository";
import type { CategorizedEntry } from "@/features/transactions/server/transaction-entry";

export async function saveImportedTransactions(accountId: string, entries: CategorizedEntry[]) {
  const db = await database();

  await db.transaction(tx => upsertTransactions(tx, accountId, entries));
}

export async function saveImportedValuations(accountId: string, entries: {
  date: string;
  amount: number;
}[]) {
  const db = await database();
  const newest = entries[entries.length - 1];
  const scope = and(eq(accounts.id, accountId), eq(accounts.environment, environment()), or(isNull(accounts.balance_date), lte(accounts.balance_date, newest.date)));

  await db.transaction(async tx => {
    for (const entry of entries) {
      await tx.insert(balanceSnapshots).values({
        id: randomUUID(),
        account_id: accountId,
        observed_at: entry.date,
        amount_minor: entry.amount,
        source: "csv"
      }).onConflictDoUpdate({
        target: [balanceSnapshots.account_id, balanceSnapshots.observed_at],
        set: {
          amount_minor: entry.amount,
          source: "csv"
        }
      });
    }

    await tx.update(accounts).set({
      balance_minor: newest.amount,
      balance_date: newest.date
    }).where(scope);
  });
}
