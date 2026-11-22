import { Temporal } from "temporal-polyfill";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots, requisitions, transactions } from "@/server/database/schema";
import { HttpError } from "@/lib/errors";
import { productTimeZone, today } from "@/lib/time";
import { dailyBalances } from "@/features/accounts/daily-balances";
import { reportedBalanceDifferences } from "@/features/accounts/reported-balances";
import { netWorthCategories, netWorthCategory, type NetWorthCategory } from "@/features/accounts/net-worth-categories";
import type { BalanceHistory, BalancePoint } from "@/features/accounts/types";
import { unsettledCash, valueHoldings, valuationSeries } from "@/features/securities/valuation";
import { readHoldingInputs } from "@/features/securities/server/valuation-repository";

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
const bookedThroughReport = sql`COALESCE((SELECT SUM(t.amount_minor) FROM ${transactions} t WHERE t.account_id=${accounts.id} AND t.suppressed_at IS NULL AND COALESCE(t.booking_date,t.date)<=${balanceSnapshots.observed_at}),0)`;
const bookedInTotal = sql`COALESCE((SELECT SUM(t.amount_minor) FROM ${transactions} t WHERE t.account_id=${accounts.id} AND t.suppressed_at IS NULL),0)`;
// Reported minus calculated balance at the end of the reported date, 0 when the report matches either reading; NULL when the newest report is not a booked balance.
const reportedDifference = sql<number | null>`(SELECT CASE WHEN ${balanceSnapshots.amount_minor}=${bookedInTotal} THEN 0 ELSE ${balanceSnapshots.amount_minor}-${bookedThroughReport} END FROM ${balanceSnapshots} WHERE ${balanceSnapshots.id}=${latestReport} AND ${balanceSnapshots.bank_balance_type} IN (${comparableTypes}))`;

const lastBookingDate = sql<string | null>`(SELECT MAX(${transactions.date}) FROM ${transactions} WHERE ${transactions.account_id}=${accounts.id} AND ${transactions.suppressed_at} IS NULL)`;

const kindOrder = sql`CASE ${accounts.kind} WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END`;

/** Accounts with their current balance and, for bank accounts, the authorization expiry. A brokerage account's balance is the value of its holdings today (ADR 012). */
export async function listAccounts(now = Temporal.Now.instant()) {
  const db = await database();
  const rows = await db.select({
    id: accounts.id,
    name: accounts.name,
    provider_name: accounts.provider_name,
    institution: requisitions.bank_name,
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
  const brokerage = rows.filter(row => row.kind === "brokerage").map(row => row.id);
  const inputs = await readHoldingInputs(brokerage);
  const date = today(now).toString();

  return rows.map(row => {
    if (row.kind !== "brokerage") {
      return {
        ...row,
        valuation: null
      };
    }

    const valuationInputs = inputs.get(row.id);

    if (!valuationInputs) {
      return {
        ...row,
        balance_minor: null,
        balance_date: null,
        valuation: null
      };
    }

    const valuation = valueHoldings(valuationInputs.holdings, date);

    return {
      ...row,
      balance_minor: valuation.value_minor + unsettledCash(valuationInputs.settlements, date),
      balance_date: date,
      valuation: {
        missing: valuation.missing,
        stale: valuation.stale
      }
    };
  });
}

/** One account with its current balance, as listed. */
export async function findAccountWithBalance(id: string, now = Temporal.Now.instant()) {
  return (await listAccounts(now)).find(account => account.id === id);
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
export async function readNetWorth(currency: string, now = Temporal.Now.instant()) {
  const relevant = (await listAccounts(now)).filter(account => account.currency === currency);
  const totals = categoryTotals(relevant);

  return {
    currency,
    netWorth: netWorthCategories.reduce((total, category) => total + totals[category], 0),
    liquidity: totals.liquidity,
    investments: totals.investments,
    property: totals.property,
    liabilities: totals.liabilities,
    unvalued: relevant.filter(account => account.balance_minor === null).length,
    incompleteValuations: relevant.filter(account => account.valuation !== null && account.valuation.missing + account.valuation.stale > 0).length
  };
}

/** An account's running balance from its transactions, ending at the last sync coverage for a bank-linked account. */
export async function readBalanceHistory(accountId: string, now = Temporal.Now.instant()): Promise<BalanceHistory> {
  const db = await database();
  const account = await db.select({
    kind: accounts.kind,
    currency: accounts.currency,
    last_synced_at: accounts.last_synced_at,
    provider: accounts.provider
  }).from(accounts).where(eq(accounts.id, accountId)).get();

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  const currentDate = today(now).toString();

  if (account.kind === "brokerage") {
    const inputs = (await readHoldingInputs([accountId])).get(accountId);

    return {
      currency: account.currency,
      balances: valuationSeries(inputs?.holdings ?? [], inputs?.settlements ?? [], currentDate).map(point => ({
        ...point,
        source: "valuation",
        bank_balance_type: null
      })),
      reported: []
    };
  }

  const bookings = await db.select({
    date: transactions.date,
    amount_minor: sql<number>`SUM(${transactions.amount_minor})`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), eq(transactions.currency, account.currency), sql`${transactions.suppressed_at} IS NULL`, sql`${transactions.date} <= ${currentDate}`)).groupBy(transactions.date).orderBy(asc(transactions.date));

  const reported = await readReportedBalances(accountId, account.provider, account.currency);

  if (!bookings.length) {
    return {
      currency: account.currency,
      balances: [],
      reported
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
    balances: dailyBalances(bookings, [start], endDate),
    reported
  };
}

/** The booked balances a still bank-linked account reported, each compared with its bookings by booking date, which the bank's balance follows. */
async function readReportedBalances(accountId: string, provider: string, currency: string) {
  if (provider === "manual") {
    return [];
  }

  const db = await database();
  const reports = await db.select({
    date: balanceSnapshots.observed_at,
    amount_minor: balanceSnapshots.amount_minor,
    bank_balance_type: balanceSnapshots.bank_balance_type
  }).from(balanceSnapshots).where(and(eq(balanceSnapshots.account_id, accountId), eq(balanceSnapshots.source, "sync"), inArray(balanceSnapshots.bank_balance_type, comparableBankBalanceTypes))).orderBy(asc(balanceSnapshots.observed_at));

  if (!reports.length) {
    return [];
  }

  const bookingDate = sql<string>`COALESCE(${transactions.booking_date}, ${transactions.date})`;
  const bookings = await db.select({
    date: bookingDate,
    amount_minor: sql<number>`SUM(${transactions.amount_minor})`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), eq(transactions.currency, currency), sql`${transactions.suppressed_at} IS NULL`)).groupBy(bookingDate);

  return reportedBalanceDifferences(reports, bookings);
}
