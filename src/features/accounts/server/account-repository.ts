import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { today } from "@/lib/time";
import type { ManualAccountInput } from "./account-schema";

export async function findManualAccount(id: string) {
  const db = await database();
  const scope = and(eq(accounts.id, id), eq(accounts.environment, environment()), eq(accounts.provider, "manual"));

  return db.select().from(accounts).where(scope).get();
}

export async function insertManualAccount(input: ManualAccountInput, amount: number) {
  const db = await database();
  const id = randomUUID();
  const date = today().toString();

  await db.transaction(async tx => {
    await tx.insert(accounts).values({
      id,
      environment: environment(),
      name: input.name,
      institution: input.institution,
      kind: input.kind,
      currency: input.currency,
      balance_minor: amount,
      balance_date: date
    });
    await tx.insert(balanceSnapshots).values({
      id: randomUUID(),
      account_id: id,
      observed_at: date,
      amount_minor: amount,
      source: "manual"
    });
  });

  return {
    id
  };
}

export async function saveManualValuation(accountId: string, amount: number, date: string) {
  const db = await database();
  const scope = and(eq(accounts.id, accountId), eq(accounts.environment, environment()), or(isNull(accounts.balance_date), lte(accounts.balance_date, date)));

  await db.transaction(async tx => {
    await tx.insert(balanceSnapshots).values({
      id: randomUUID(),
      account_id: accountId,
      observed_at: date,
      amount_minor: amount,
      source: "manual"
    }).onConflictDoUpdate({
      target: [balanceSnapshots.account_id, balanceSnapshots.observed_at],
      set: {
        amount_minor: amount,
        source: "manual"
      }
    });
    await tx.update(accounts).set({
      balance_minor: amount,
      balance_date: date
    }).where(scope);
  });
}
