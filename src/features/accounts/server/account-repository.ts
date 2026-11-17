import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { recordManualBalance } from "@/features/transactions/server/manual-transaction-repository";
import type { ManualAccountInput } from "./account-schema";

export async function findManualAccount(id: string) {
  const db = await database();
  const scope = and(eq(accounts.id, id), eq(accounts.environment, environment()), eq(accounts.provider, "manual"));

  return db.select().from(accounts).where(scope).get();
}

/** Creates a manual account with its starting balance as the opening balance transaction. */
export async function insertManualAccount(input: ManualAccountInput, amount: number, date: string) {
  const db = await database();
  const id = randomUUID();

  await db.transaction(async tx => {
    await tx.insert(accounts).values({
      id,
      environment: environment(),
      name: input.name,
      institution: input.institution,
      kind: input.kind,
      currency: input.currency
    });
    await recordManualBalance(tx, {
      id,
      currency: input.currency
    }, date, amount);
  });

  return {
    id
  };
}

/** Records a manual account's balance on a date as an opening balance or an adjustment for the difference. */
export async function saveManualValuation(account: {
  id: string;
  currency: string;
}, amount: number, date: string) {
  const db = await database();

  return db.transaction(tx => recordManualBalance(tx, account, date, amount));
}
