import { and, asc, eq, inArray, isNull, max, ne, or, sql, isNotNull } from "drizzle-orm";
import { union } from "drizzle-orm/sqlite-core";
import { database, type Database, type DatabaseTransaction } from "@/server/database/connection";
import { withRefusableTransaction } from "@/server/database/transaction";
import { accounts, securities, securitySplits, securityTrades, securityTransfers, transactions } from "@/server/database/schema";
import { manualEntryPrefix } from "@/lib/booking-references";
import { derivedTransactionType } from "@/lib/transaction-types";
import { bookableAccount } from "@/features/transactions/server/booking-accounts";
import { notSplit, notSplitBooking } from "@/features/transactions/server/split-repository";
import { notTradeLeg, tradeLeg } from "@/features/transactions/server/trade-leg-rules";
import type { LegSide, TradeSide } from "../trade-sides";
import type { SecurityLeg } from "../transfers";
import { settlementWindowDays } from "../trade-decisions";

type Executor = Database | DatabaseTransaction;

export { withRefusableTransaction as withSecurityTransaction };

export type NewSecurity = {
  id: string;
  isin: string | null;
  name: string;
  currency: string;
  provider: string | null;
  provider_symbol: string | null;
  venue: string | null;
};

/** Inserts a security; false when its provider symbol is already taken. */
export async function insertSecurity(security: NewSecurity) {
  const db = await database();
  const inserted = await db.insert(securities).values(security).onConflictDoNothing().returning({
    id: securities.id
  });

  return inserted.length > 0;
}

export async function listSecurities() {
  const db = await database();

  return db.select({
    id: securities.id,
    isin: securities.isin,
    name: securities.name,
    currency: securities.currency,
    provider: securities.provider,
    provider_symbol: securities.provider_symbol,
    venue: securities.venue,
    price_checked_at: securities.price_checked_at,
    price_error: securities.price_error
  }).from(securities).orderBy(asc(securities.name), asc(securities.id));
}

export async function findSecurity(executor: Executor, id: string) {
  return executor.select({
    id: securities.id,
    name: securities.name,
    currency: securities.currency
  }).from(securities).where(eq(securities.id, id)).get();
}

export async function insertBrokerageAccount(id: string, account: {
  name: string;
  currency: string;
}) {
  const db = await database();

  await db.insert(accounts).values({
    id,
    name: account.name,
    kind: "brokerage",
    currency: account.currency
  });
}

export async function findBrokerageAccount(executor: Executor, id: string) {
  return executor.select({
    id: accounts.id,
    name: accounts.name,
    currency: accounts.currency,
    archived_at: accounts.archived_at
  }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.kind, "brokerage"))).get();
}

/** Every brokerage account, archived ones included, whose past holdings still belong to the combined history. */
export async function listAllBrokerageAccounts() {
  const db = await database();

  return db.select({
    id: accounts.id,
    currency: accounts.currency,
    archived_at: accounts.archived_at
  }).from(accounts).where(eq(accounts.kind, "brokerage")).orderBy(asc(accounts.name));
}

/** A manual or bank-linked account that can carry the cash side of a trade. */
export async function findSettlementAccount(tx: DatabaseTransaction, id: string) {
  return tx.select({
    id: accounts.id,
    provider: accounts.provider,
    currency: accounts.currency,
    archived_at: accounts.archived_at
  }).from(accounts).where(and(eq(accounts.id, id), bookableAccount)).get();
}

const bookingFacts = {
  id: transactions.id,
  account_id: transactions.account_id,
  account_provider: accounts.provider,
  account_kind: accounts.kind,
  account_archived_at: accounts.archived_at,
  date: transactions.date,
  amount_minor: transactions.amount_minor,
  currency: transactions.currency,
  transfer_id: transactions.transfer_id,
  transfer_detected: transactions.transfer_detected,
  suppressed_at: transactions.suppressed_at,
  provider_reference: transactions.provider_reference,
  trade_leg: tradeLeg,
  split: sql<number>`NOT ${notSplit}`.mapWith(Number)
};

export async function findSettlementBooking(executor: Executor, id: string) {
  return executor.select(bookingFacts).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(transactions.id, id)).get();
}

/** Bank bookings that can be the cash side of a trade of `amount` on `date`: imported, visible, unlinked, not split and not already a trade's cash side. */
export async function readSettlementCandidates(currency: string, amount: number, date: string) {
  const db = await database();
  const window = sql`${transactions.date} BETWEEN date(${date},${`-${settlementWindowDays} days`}) AND date(${date},${`+${settlementWindowDays} days`})`;

  return db.select({
    id: transactions.id,
    account_id: transactions.account_id,
    account_name: accounts.name,
    date: transactions.date,
    amount_minor: transactions.amount_minor,
    currency: transactions.currency,
    counterparty: sql<string>`COALESCE(${transactions.counterparty_override},${transactions.counterparty})`,
    description: sql<string>`COALESCE(${transactions.description_override},${transactions.description})`
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(and(ne(accounts.provider, "manual"), bookableAccount, isNull(accounts.archived_at), eq(transactions.currency, currency), eq(transactions.amount_minor, amount), isNull(transactions.transfer_id), isNull(transactions.suppressed_at), sql`${transactions.provider_reference} NOT LIKE ${`${manualEntryPrefix}%`}`, notSplitBooking(transactions), notTradeLeg, window)).orderBy(asc(transactions.date), asc(transactions.id));
}

/**
 * Every trade and transfer leg of the given securities on every account, in replay order; transfer legs carry no cost yet (see `resolveTransferCosts`).
 * A transfer's legs reach into other accounts, so a holding's history is always read for the security as a whole.
 */
export async function readSecurityLegs(executor: Executor, securityIds: string[]): Promise<(SecurityLeg & {
  id: string;
  security_id: string
})[]> {
  if (!securityIds.length) {
    return [];
  }

  const trades = await executor.select({
    id: securityTrades.id,
    security_id: securityTrades.security_id,
    account_id: securityTrades.account_id,
    date: securityTrades.date,
    side: securityTrades.side,
    sequence: securityTrades.sequence,
    quantity_micros: securityTrades.quantity_micros,
    gross_minor: securityTrades.gross_minor,
    fee_minor: securityTrades.fee_minor
  }).from(securityTrades).where(inArray(securityTrades.security_id, securityIds));
  const transfers = await executor.select({
    id: securityTransfers.id,
    security_id: securityTransfers.security_id,
    from_account_id: securityTransfers.from_account_id,
    to_account_id: securityTransfers.to_account_id,
    date: securityTransfers.date,
    from_sequence: securityTransfers.from_sequence,
    to_sequence: securityTransfers.to_sequence,
    quantity_micros: securityTransfers.quantity_micros
  }).from(securityTransfers).where(inArray(securityTransfers.security_id, securityIds));
  const legs = [...trades.map(trade => ({
    ...trade,
    side: trade.side as LegSide,
    transfer_id: null
  })), ...transfers.flatMap(transfer => [transferLeg(transfer, "transfer_out"), transferLeg(transfer, "transfer_in")])];

  return legs.toSorted((left, right) => left.date.localeCompare(right.date) || left.sequence - right.sequence);
}

function transferLeg(transfer: {
  id: string;
  security_id: string;
  from_account_id: string;
  to_account_id: string;
  date: string;
  from_sequence: number;
  to_sequence: number;
  quantity_micros: number;
}, side: "transfer_in" | "transfer_out") {
  const sent = side === "transfer_out";

  return {
    id: transfer.id,
    security_id: transfer.security_id,
    account_id: sent ? transfer.from_account_id : transfer.to_account_id,
    date: transfer.date,
    side,
    sequence: sent ? transfer.from_sequence : transfer.to_sequence,
    quantity_micros: transfer.quantity_micros,
    gross_minor: 0,
    fee_minor: 0,
    transfer_id: transfer.id
  };
}

export async function readSplits(executor: Executor, securityId: string) {
  return executor.select({
    date: securitySplits.date,
    numerator: securitySplits.numerator,
    denominator: securitySplits.denominator
  }).from(securitySplits).where(eq(securitySplits.security_id, securityId)).orderBy(asc(securitySplits.date));
}

/** The next replay position on the account, after its trades and transfer legs; read inside the write transaction. */
export async function nextTradeSequence(tx: DatabaseTransaction, accountId: string) {
  const trades = await tx.select({
    sequence: max(securityTrades.sequence)
  }).from(securityTrades).where(eq(securityTrades.account_id, accountId)).get();
  const sent = await tx.select({
    sequence: max(securityTransfers.from_sequence)
  }).from(securityTransfers).where(eq(securityTransfers.from_account_id, accountId)).get();
  const received = await tx.select({
    sequence: max(securityTransfers.to_sequence)
  }).from(securityTransfers).where(eq(securityTransfers.to_account_id, accountId)).get();

  return Math.max(trades?.sequence ?? 0, sent?.sequence ?? 0, received?.sequence ?? 0) + 1;
}

export type NewTrade = {
  id: string;
  account_id: string;
  security_id: string;
  date: string;
  side: TradeSide;
  sequence: number;
  quantity_micros: number;
  price_micros: number;
  gross_minor: number;
  fee_minor: number;
  tax_minor: number;
  settlement_transaction_id: string;
};

export async function insertTrade(tx: DatabaseTransaction, trade: NewTrade) {
  await tx.insert(securityTrades).values(trade);
}

/** Books the cash side of a trade on a manual settlement account as an entry that belongs to the trade. */
export async function insertSettlementEntry(tx: DatabaseTransaction, entry: {
  id: string;
  account_id: string;
  date: string;
  amount_minor: number;
  currency: string;
  type: TradeSide;
  counterparty: string;
  description: string;
}) {
  await tx.insert(transactions).values({
    id: entry.id,
    account_id: entry.account_id,
    provider_reference: `${manualEntryPrefix}${entry.id}`,
    date: entry.date,
    amount_minor: entry.amount_minor,
    currency: entry.currency,
    counterparty: entry.counterparty,
    description: entry.description,
    category_source: "manual",
    type: entry.type,
    type_source: "manual"
  });
}

/** Makes an imported bank booking the cash side of a trade; the manual type keeps later syncs and rules from changing it. */
export async function markSettlementBooking(tx: DatabaseTransaction, id: string, type: TradeSide) {
  await tx.update(transactions).set({
    type,
    type_source: "manual",
    type_rule_id: null,
    type_transfer_account_id: null
  }).where(eq(transactions.id, id));
}

export async function findTrade(executor: Executor, id: string) {
  return executor.select({
    id: securityTrades.id,
    account_id: securityTrades.account_id,
    security_id: securityTrades.security_id,
    side: securityTrades.side,
    sequence: securityTrades.sequence,
    settlement_transaction_id: securityTrades.settlement_transaction_id
  }).from(securityTrades).where(eq(securityTrades.id, id)).get();
}

/** Saves a corrected trade; its side, security and cash side stay. */
export async function saveTradeCorrection(tx: DatabaseTransaction, id: string, correction: {
  date: string;
  quantity_micros: number;
  price_micros: number;
  gross_minor: number;
  fee_minor: number;
  tax_minor: number;
}) {
  await tx.update(securityTrades).set(correction).where(eq(securityTrades.id, id));
}

/** Moves a trade's own cash entry to the corrected date and amount. */
export async function saveSettlementEntry(tx: DatabaseTransaction, id: string, entry: {
  date: string;
  amount_minor: number;
  description: string;
}) {
  await tx.update(transactions).set(entry).where(eq(transactions.id, id));
}

/** Deletes a trade and releases its cash side: an entry booked for it is removed, a linked bank booking returns to the type its delivery implies. */
export async function deleteTrade(tx: DatabaseTransaction, trade: NonNullable<Awaited<ReturnType<typeof findTrade>>>) {
  await tx.delete(securityTrades).where(eq(securityTrades.id, trade.id));

  if (!trade.settlement_transaction_id) {
    return;
  }

  const booking = await findSettlementBooking(tx, trade.settlement_transaction_id);

  if (!booking) {
    return;
  }

  // Linked bank bookings are never Ufer entries, so the reference identifies an entry the trade booked even after its account was connected to a bank.
  if (booking.provider_reference.startsWith(manualEntryPrefix)) {
    await tx.delete(transactions).where(eq(transactions.id, booking.id));

    return;
  }

  await tx.update(transactions).set({
    type: derivedTransactionType(booking.amount_minor, booking.transfer_detected === 1),
    type_source: "auto"
  }).where(eq(transactions.id, booking.id));
}

/** Every trade on a brokerage account with its security, in replay order. */
export async function readAccountTrades(accountId: string) {
  const db = await database();

  return db.select({
    id: securityTrades.id,
    security_id: securityTrades.security_id,
    security_name: securities.name,
    currency: securities.currency,
    date: securityTrades.date,
    side: securityTrades.side,
    sequence: securityTrades.sequence,
    quantity_micros: securityTrades.quantity_micros,
    price_micros: securityTrades.price_micros,
    gross_minor: securityTrades.gross_minor,
    fee_minor: securityTrades.fee_minor,
    tax_minor: securityTrades.tax_minor,
    settlement_transaction_id: securityTrades.settlement_transaction_id,
    settlement_account_id: transactions.account_id,
    settlement_account_name: accounts.name,
    settlement_counterparty: sql<string | null>`COALESCE(${transactions.counterparty_override}, ${transactions.counterparty})`,
    settlement_description: sql<string | null>`COALESCE(${transactions.description_override}, ${transactions.description})`
  }).from(securityTrades).innerJoin(securities, eq(securities.id, securityTrades.security_id)).leftJoin(transactions, eq(transactions.id, securityTrades.settlement_transaction_id)).leftJoin(accounts, eq(accounts.id, transactions.account_id)).where(eq(securityTrades.account_id, accountId)).orderBy(asc(securityTrades.date), asc(securityTrades.sequence));
}

/** The securities the given accounts have traded, sent or received. */
export async function readTradedSecurityIds(executor: Executor, accountIds: string[]) {
  if (!accountIds.length) {
    return [];
  }

  const rows = await union(executor.select({
    security_id: securityTrades.security_id
  }).from(securityTrades).where(inArray(securityTrades.account_id, accountIds)), executor.select({
    security_id: securityTransfers.security_id
  }).from(securityTransfers).where(or(inArray(securityTransfers.from_account_id, accountIds), inArray(securityTransfers.to_account_id, accountIds))));

  return rows.map(row => row.security_id);
}

/**
 * Returns the security recorded for an ISIN in a currency, inserting `security` when there is none, inside the caller's transaction; a trade uses its own, so a rejected trade leaves no new security behind.
 * Of several listings of the same ISIN, the oldest listed one is used, so the trade gets prices; a listing another security already uses is left off a new row.
 */
export async function findOrInsertSecurity(tx: DatabaseTransaction, security: NewSecurity & {
  isin: string
}) {
  const existing = await tx.select({
    id: securities.id,
    name: securities.name,
    currency: securities.currency,
    provider_symbol: securities.provider_symbol
  }).from(securities).where(and(eq(securities.isin, security.isin), eq(securities.currency, security.currency))).orderBy(sql`${securities.provider_symbol} IS NULL`, asc(securities.created_at)).get();

  if (existing) {
    return {
      ...existing,
      created: false
    };
  }

  const taken = security.provider_symbol ? await tx.select({
    id: securities.id
  }).from(securities).where(eq(securities.provider_symbol, security.provider_symbol)).get() : undefined;
  const row = taken ? {
    ...security,
    provider: null,
    provider_symbol: null,
    venue: null
  } : security;

  await tx.insert(securities).values(row);

  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    provider_symbol: row.provider_symbol,
    created: true
  };
}

/** Whether no trade of the security, on any account, lies on or before `date`. */
export async function isEarliestTrade(tx: DatabaseTransaction, securityId: string, date: string) {
  const earlier = await tx.select({
    id: securityTrades.id
  }).from(securityTrades).where(and(eq(securityTrades.security_id, securityId), sql`${securityTrades.date} <= ${date}`)).get();

  return !earlier;
}

/** Clears the last price check so the next update checks the security's splits again; a security without a listing has no splits to check and keeps its check time, so a "No price listing" choice stays. */
export async function markSplitsUnchecked(tx: DatabaseTransaction, securityId: string) {
  await tx.update(securities).set({
    price_checked_at: null
  }).where(and(eq(securities.id, securityId), isNotNull(securities.provider_symbol)));
}
