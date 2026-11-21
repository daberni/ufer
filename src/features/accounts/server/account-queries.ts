import { Temporal } from "temporal-polyfill";
import { and, asc, eq, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots, requisitions, transactions } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";
import { productTimeZone, today } from "@/lib/time";
import { dailyBalances } from "@/features/accounts/daily-balances";
import { netWorthCategories, netWorthCategory, type NetWorthCategory } from "@/features/accounts/net-worth-categories";
import type { BalanceHistory, BalancePoint } from "@/features/accounts/types";

// Every account's balance is the sum of its visible transactions, dated with its newest one.
const balance = sql<number | null>`(SELECT SUM(${transactions.amount_minor}) FROM ${transactions} WHERE ${transactions.account_id}=${accounts.id} AND ${transactions.suppressed_at} IS NULL)`;

/** Balance types that report booked money; available balances include credit lines and pending items, so they are never compared with bookings. */
export const comparableBankBalanceTypes = ["CLBD", "ITBD", "PRCD"];

// The newest balance the bank reported to a still bank-linked account, kept for comparison with the calculated balance.
const latestReport = sql`(SELECT s.id FROM ${balanceSnapshots} s WHERE s.account_id=${accounts.id} AND ${accounts.provider}<>'manual' AND s.source='sync' ORDER BY s.observed_at DESC LIMIT 1)`;
const reportedBalance = sql<number | null>`(SELECT ${balanceSnapshots.amount_minor} FROM ${balanceSnapshots} WHERE ${balanceSnapshots.id}=${latestReport})`;
const reportedBalanceDate = sql<string | null>`(SELECT ${balanceSnapshots.observed_at} FROM ${balanceSnapshots} WHERE ${balanceSnapshots.id}=${latestReport})`;
const comparableTypes = sql.join(comparableBankBalanceTypes.map(type => sql`${type}`), sql`,`);
// Bookings through the reported date, and all bookings: a bank may date a weekend booking on the next business day while its same-day balance already contains it.
// The bank's balance follows its own booking dates, not the value dates bookings count on.
const bookedThroughReport = sql`COALESCE((SELECT SUM(t.amount_minor) FROM ${transactions} t WHERE t.account_id=${accounts.id} AND t.suppressed_at IS NULL AND COALESCE(t.bank_booking_date,t.date)<=${balanceSnapshots.observed_at}),0)`;
const bookedInTotal = sql`COALESCE((SELECT SUM(t.amount_minor) FROM ${transactions} t WHERE t.account_id=${accounts.id} AND t.suppressed_at IS NULL),0)`;
// Reported minus calculated balance at the end of the reported date, 0 when the report matches either reading; NULL when the newest report is not a booked balance.
const reportedDifference = sql<number | null>`(SELECT CASE WHEN ${balanceSnapshots.amount_minor}=${bookedInTotal} THEN 0 ELSE ${balanceSnapshots.amount_minor}-${bookedThroughReport} END FROM ${balanceSnapshots} WHERE ${balanceSnapshots.id}=${latestReport} AND ${balanceSnapshots.bank_balance_type} IN (${comparableTypes}))`;

const lastBookingDate = sql<string | null>`(SELECT MAX(${transactions.date}) FROM ${transactions} WHERE ${transactions.account_id}=${accounts.id} AND ${transactions.suppressed_at} IS NULL)`;

const kindOrder = sql`CASE ${accounts.kind} WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END`;

/** Accounts with their current balance and, for bank accounts, the authorization expiry. */
export async function listAccounts() {
  const db = await database();

  return db.select({
    id: accounts.id,
    name: accounts.name,
    provider_name: accounts.provider_name,
    institution: accounts.institution,
    kind: accounts.kind,
    currency: accounts.currency,
    balance_minor: balance,
    balance_date: lastBookingDate,
    last_booking_date: lastBookingDate,
    reported_balance_minor: reportedBalance,
    reported_balance_date: reportedBalanceDate,
    reported_difference_minor: reportedDifference,
    provider: accounts.provider,
    requisition_id: accounts.requisition_id,
    last_synced_at: accounts.last_synced_at,
    valid_until: requisitions.valid_until,
    sync_error: accounts.sync_error,
    archived_at: accounts.archived_at
  }).from(accounts).leftJoin(requisitions, eq(requisitions.id, accounts.requisition_id)).orderBy(kindOrder, asc(accounts.name));
}

/** One account with its current balance, as listed. */
export async function findAccountWithBalance(id: string) {
  return (await listAccounts()).find(account => account.id === id);
}

function categoryTotals(accountsInCurrency: {
  kind: string;
  balance_minor: number | null
}[]) {
  const totals: Record<NetWorthCategory, number> = {
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0
  };

  for (const account of accountsInCurrency) {
    const category = netWorthCategory(account.kind);

    if (category) {
      totals[category] += account.balance_minor ?? 0;
    }
  }

  return totals;
}

/** Net worth and its composition from the latest known balances of the accounts in one currency; it does not depend on a period. Archived accounts still count, so archiving never changes a report. */
export async function readNetWorth(currency: string) {
  const relevant = (await listAccounts()).filter(account => account.currency === currency);
  const totals = categoryTotals(relevant);

  return {
    currency,
    netWorth: netWorthCategories.reduce((total, category) => total + totals[category], 0),
    liquidity: totals.liquidity,
    investments: totals.investments,
    property: totals.property,
    liabilities: totals.liabilities,
    unvalued: relevant.filter(account => account.balance_minor === null).length
  };
}

/** An account's running balance from its transactions, ending at the last sync coverage for a bank-linked account. */
export async function readBalanceHistory(accountId: string): Promise<BalanceHistory> {
  const db = await database();
  const account = await db.select({
    currency: accounts.currency,
    last_synced_at: accounts.last_synced_at,
    provider: accounts.provider
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  const currentDate = today().toString();
  const bookings = await db.select({
    date: transactions.date,
    amount_minor: sql<number>`SUM(${transactions.amount_minor})`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), eq(transactions.currency, account.currency), sql`${transactions.suppressed_at} IS NULL`, sql`${transactions.date} <= ${currentDate}`)).groupBy(transactions.date).orderBy(asc(transactions.date));

  if (!bookings.length) {
    return {
      currency: account.currency,
      balances: []
    };
  }

  // The balance is the sum of all bookings, so it is 0 the day before the first one.
  const start: BalancePoint = {
    date: Temporal.PlainDate.from(bookings[0].date).subtract({
      days: 1
    }).toString(),
    amount_minor: 0,
    source: "transactions",
    bank_balance_type: null
  };
  const latestReport = await db.select({
    date: sql<string | null>`MAX(${balanceSnapshots.observed_at})`
  }).from(balanceSnapshots).where(eq(balanceSnapshots.account_id, accountId)).get();
  const lastSyncDate = account.last_synced_at ? Temporal.Instant.from(account.last_synced_at).toZonedDateTimeISO(productTimeZone).toPlainDate().toString() : undefined;
  // A successful sync bounds coverage; stale bank data must not become a series of seemingly current daily balances.
  const lastCoverage = [latestReport?.date, bookings.at(-1)?.date, lastSyncDate].filter((date): date is string => Boolean(date)).sort().at(-1) ?? currentDate;
  const endDate = account.provider === "enable_banking" && lastCoverage < currentDate ? lastCoverage : currentDate;

  return {
    currency: account.currency,
    balances: dailyBalances(bookings, [start], endDate)
  };
}
