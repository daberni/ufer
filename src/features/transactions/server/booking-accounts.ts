import { and, eq, isNull, sql } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";

// The account facts bookings depend on. Transactions never imports the accounts feature: decisions and writes take these facts as values, read here from the shared schema.

/** Accounts whose balance is the sum of their bookings. A brokerage account holds securities instead (ADR 012), so it takes no bookings, balances, transfers or bank connection. */
export const bookableAccount = sql`${accounts.kind}<>'brokerage'`;

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

/** Rechecks inside a manual-only write transaction that the account is still an active manual account; a bank connection may have linked it after the request's own check. */
export async function assertWritableManualAccount(tx: DatabaseTransaction, accountId: string) {
  const account = await tx.select({
    provider: accounts.provider,
    kind: accounts.kind,
    archived_at: accounts.archived_at
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  if (account?.kind === "brokerage") {
    throw new HttpError(409, "A brokerage account holds securities and takes no bookings.");
  }

  if (account && account.provider !== "manual") {
    throw new HttpError(409, "This account is now connected to a bank. Reload the page to see its current state.");
  }

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
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.provider, "manual"), bookableAccount)).get();

  if (!account) {
    throw new HttpError(404, notFound);
  }

  if (account.archived_at !== null) {
    throw new HttpError(409, archivedAccountMessage);
  }

  return account;
}
