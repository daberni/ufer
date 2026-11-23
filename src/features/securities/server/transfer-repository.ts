import { alias } from "drizzle-orm/sqlite-core";
import { asc, eq, or } from "drizzle-orm";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { accounts, securities, securityTransfers } from "@/server/database/schema";

type Executor = Database | DatabaseTransaction;

export type NewTransfer = {
  id: string;
  security_id: string;
  from_account_id: string;
  to_account_id: string;
  date: string;
  from_sequence: number;
  to_sequence: number;
  quantity_micros: number;
};

export async function insertTransfer(tx: DatabaseTransaction, transfer: NewTransfer) {
  await tx.insert(securityTransfers).values(transfer);
}

export async function findTransfer(executor: Executor, id: string) {
  return executor.select({
    id: securityTransfers.id,
    security_id: securityTransfers.security_id,
    from_account_id: securityTransfers.from_account_id,
    to_account_id: securityTransfers.to_account_id,
    from_sequence: securityTransfers.from_sequence,
    to_sequence: securityTransfers.to_sequence
  }).from(securityTransfers).where(eq(securityTransfers.id, id)).get();
}

export async function saveTransferCorrection(tx: DatabaseTransaction, id: string, correction: {
  date: string;
  quantity_micros: number;
}) {
  await tx.update(securityTransfers).set(correction).where(eq(securityTransfers.id, id));
}

export async function deleteTransfer(tx: DatabaseTransaction, id: string) {
  await tx.delete(securityTransfers).where(eq(securityTransfers.id, id));
}

/** The transfers an account sent or received, with both accounts' names. */
export async function readAccountTransfers(accountId: string) {
  const db = await database();
  const sender = alias(accounts, "sender");
  const receiver = alias(accounts, "receiver");

  return db.select({
    id: securityTransfers.id,
    security_id: securityTransfers.security_id,
    security_name: securities.name,
    currency: securities.currency,
    date: securityTransfers.date,
    from_account_id: securityTransfers.from_account_id,
    from_account_name: sender.name,
    to_account_id: securityTransfers.to_account_id,
    to_account_name: receiver.name,
    from_sequence: securityTransfers.from_sequence,
    to_sequence: securityTransfers.to_sequence,
    quantity_micros: securityTransfers.quantity_micros
  }).from(securityTransfers).innerJoin(securities, eq(securities.id, securityTransfers.security_id)).innerJoin(sender, eq(sender.id, securityTransfers.from_account_id)).innerJoin(receiver, eq(receiver.id, securityTransfers.to_account_id)).where(or(eq(securityTransfers.from_account_id, accountId), eq(securityTransfers.to_account_id, accountId))).orderBy(asc(securityTransfers.date));
}
