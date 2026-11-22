import { and, eq, isNull } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";

// The account facts bookings depend on. Transactions never imports the accounts feature: decisions and writes take these facts as values, read here from the shared schema.

export const archivedAccountMessage = "This account is archived. Restore the account first.";

/** Rechecks inside a write transaction that the account is not archived, since it may have been archived after the request's own check; throwing rolls the transaction back. */
export async function assertWritableAccount(tx: DatabaseTransaction, accountId: string) {
  const account = await tx.select({
    archived_at: accounts.archived_at
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  if (account?.archived_at) {
    throw new HttpError(409, archivedAccountMessage);
  }
}

/** The accounts that are not archived. Archiving freezes bookkeeping, so only bookings on these accounts take a new type. */
export async function readActiveAccountIds(executor: Pick<Database, "select">) {
  const active = await executor.select({
    id: accounts.id
  }).from(accounts).where(isNull(accounts.archived_at));

  return active.map(account => account.id);
}

/** A manual account that accepts new bookings; an archived account is read-only until it is restored. */
export async function requireWritableManualAccount(accountId: string, notFound: string) {
  const db = await database();
  const account = await db.select({
    id: accounts.id,
    currency: accounts.currency,
    archived_at: accounts.archived_at
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.provider, "manual"))).get();

  if (!account) {
    throw new HttpError(404, notFound);
  }

  if (account.archived_at !== null) {
    throw new HttpError(409, archivedAccountMessage);
  }

  return account;
}
