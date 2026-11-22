import { and, eq, inArray, isNull, ne, notExists } from "drizzle-orm";
import { bookableAccount } from "@/features/transactions/server/booking-accounts";
import type { DatabaseTransaction } from "@/server/database/connection";
import { accountIdentifiers, accounts, requisitions } from "@/server/database/schema";
import type { ConnectTarget, IdentifierMatch, MappableBankAccount } from "./bank-account-mapping";

/** The manual account an authorization connects, read again in the callback's transaction; undefined once it was archived, linked or deleted. */
export async function findConnectTarget(tx: DatabaseTransaction, id: string): Promise<ConnectTarget | undefined> {
  return tx.select({
    id: accounts.id,
    currency: accounts.currency,
    iban: accounts.iban
  }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.provider, "manual"), bookableAccount, isNull(accounts.requisition_id), isNull(accounts.archived_at))).get();
}

/** The existing accounts any of the identifiers belong to, each with its connection. */
export async function findIdentifierMatches(tx: DatabaseTransaction, hashes: string[]): Promise<IdentifierMatch[]> {
  return tx.selectDistinct({
    account_id: accountIdentifiers.account_id,
    requisition_id: accounts.requisition_id
  }).from(accountIdentifiers).innerJoin(accounts, eq(accounts.id, accountIdentifiers.account_id)).where(inArray(accountIdentifiers.identification_hash, hashes));
}

function providerName(account: MappableBankAccount) {
  return account.name || account.product || null;
}

/** Links an existing account, bank or manual, to the connection and refreshes its provider details; false when its currency differs from the bank's. */
export async function relinkAccount(tx: DatabaseTransaction, id: string, requisitionId: string, account: MappableBankAccount) {
  const accountScope = and(eq(accounts.id, id), eq(accounts.currency, account.currency));
  const name = providerName(account);
  const iban = account.account_id?.iban;
  const saved = await tx.update(accounts).set({
    provider: "enable_banking",
    provider_uid: account.uid,
    ...(name ? {
      provider_name: name
    } : {}),
    requisition_id: requisitionId,
    ...(iban ? {
      iban
    } : {}),
    sync_error: null
  }).where(accountScope).returning({
    id: accounts.id
  });

  return saved.length > 0;
}

/** Creates a checking account for a bank account seen for the first time, named after the account or else the institution. */
export async function insertBankAccount(tx: DatabaseTransaction, id: string, requisitionId: string, institution: string, account: MappableBankAccount) {
  const name = providerName(account);

  await tx.insert(accounts).values({
    id,
    name: name || institution,
    provider_name: name,
    kind: "checking",
    currency: account.currency,
    provider: "enable_banking",
    provider_uid: account.uid,
    requisition_id: requisitionId,
    iban: account.account_id?.iban || null
  });
}

export async function saveIdentifiers(tx: DatabaseTransaction, accountId: string, hashes: string[]) {
  await tx.insert(accountIdentifiers).values(hashes.map(identification => ({
    identification_hash: identification,
    account_id: accountId
  }))).onConflictDoNothing();
}

/** Marks a connection still being exchanged as linked; false when it was removed meanwhile. */
export async function markConnectionLinked(tx: DatabaseTransaction, requisitionId: string, validUntil: string) {
  const linked = await tx.update(requisitions).set({
    status: "LINKED",
    valid_until: validUntil
  }).where(and(eq(requisitions.id, requisitionId), eq(requisitions.status, "EXCHANGING"))).returning({
    id: requisitions.id
  });

  return linked.length > 0;
}

/** Supersedes the displaced linked connections that no account links to anymore, returning their sessions to revoke. */
export async function supersedeEmptyConnections(tx: DatabaseTransaction, displaced: string[], requisitionId: string) {
  const linkedAccounts = tx.select({
    id: accounts.id
  }).from(accounts).where(eq(accounts.requisition_id, requisitions.id));
  const superseded = and(eq(requisitions.status, "LINKED"), inArray(requisitions.id, displaced), ne(requisitions.id, requisitionId), notExists(linkedAccounts));

  return tx.update(requisitions).set({
    status: "SUPERSEDED"
  }).where(superseded).returning({
    id: requisitions.id,
    session_cipher: requisitions.session_cipher
  });
}
