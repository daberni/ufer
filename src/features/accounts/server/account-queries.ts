import { Temporal } from "temporal-polyfill";
import { and, asc, eq, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots, requisitions, transactions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { HttpError } from "@/lib/errors";
import { productTimeZone, today } from "@/lib/time";
import { dailyBalances } from "@/features/accounts/daily-balances";
import type { BalanceHistory, BalancePoint } from "@/features/accounts/types";

// A manual account's balance is the sum of its transactions, dated with the newest one; a synced account keeps its provider balance.
const manual = sql`${accounts.provider}='manual'`;
const balance = sql<number | null>`CASE WHEN ${manual} THEN (SELECT SUM(${transactions.amount_minor}) FROM ${transactions} WHERE ${transactions.account_id}=${accounts.id}) ELSE ${accounts.balance_minor} END`;
const balanceDate = sql<string | null>`CASE WHEN ${manual} THEN (SELECT MAX(${transactions.booking_date}) FROM ${transactions} WHERE ${transactions.account_id}=${accounts.id}) ELSE ${accounts.balance_date} END`;

const kindOrder = sql`CASE ${accounts.kind} WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END`;

/** Accounts of the current banking environment with their current balance and, for bank accounts, the authorization expiry. */
export async function listAccounts() {
  const db = await database();

  return db.select({
    id: accounts.id,
    name: accounts.name,
    institution: accounts.institution,
    kind: accounts.kind,
    currency: accounts.currency,
    balance_minor: balance,
    balance_date: balanceDate,
    provider: accounts.provider,
    requisition_id: accounts.requisition_id,
    last_synced_at: accounts.last_synced_at,
    valid_until: requisitions.valid_until,
    sync_error: accounts.sync_error
  }).from(accounts).leftJoin(requisitions, eq(requisitions.id, accounts.requisition_id)).where(eq(accounts.environment, environment())).orderBy(kindOrder, asc(accounts.name));
}

/** Net worth and its composition from the latest known balances of the accounts in one currency; it does not depend on a period. */
export async function readNetWorth(currency: string) {
  const relevant = (await listAccounts()).filter(account => account.currency === currency);
  const sum = (kinds: string[]) => relevant.filter(account => kinds.includes(account.kind)).reduce((total, account) => total + (account.balance_minor ?? 0), 0);

  return {
    currency,
    netWorth: sum(["checking", "savings", "investment", "property", "credit_card", "loan"]),
    liquidity: sum(["checking", "savings", "credit_card"]),
    investments: sum(["investment"]),
    property: sum(["property"]),
    liabilities: sum(["loan"]),
    unvalued: relevant.filter(account => account.balance_minor === null).length
  };
}

/** Daily estimates between recorded cash-account balances, or recorded asset valuations, scoped to the current banking environment. */
export async function readBalanceHistory(accountId: string): Promise<BalanceHistory> {
  const db = await database();
  const account = await db.select({
    currency: accounts.currency,
    kind: accounts.kind,
    last_synced_at: accounts.last_synced_at,
    balance_minor: accounts.balance_minor,
    balance_date: accounts.balance_date,
    provider: accounts.provider
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.environment, environment()))).get();

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  const balances = await db.select({
    date: balanceSnapshots.observed_at,
    amount_minor: balanceSnapshots.amount_minor,
    source: balanceSnapshots.source,
    bank_balance_type: balanceSnapshots.bank_balance_type
  }).from(balanceSnapshots).where(eq(balanceSnapshots.account_id, accountId)).orderBy(asc(balanceSnapshots.observed_at));

  const currentDate = today().toString();
  const bookings = await db.select({
    date: transactions.booking_date,
    amount_minor: sql<number>`SUM(${transactions.amount_minor})`.mapWith(Number),
    opening: sql<number>`MAX(CASE WHEN ${transactions.type}='opening_balance' THEN 1 ELSE 0 END)`.mapWith(Number)
  }).from(transactions).where(and(eq(transactions.account_id, accountId), eq(transactions.currency, account.currency), sql`${transactions.booking_date} <= ${currentDate}`)).groupBy(transactions.booking_date).orderBy(asc(transactions.booking_date));
  const providerSources = {
    enable_banking: "sync",
    csv: "csv",
    manual: "manual"
  } as const;
  const source = providerSources[account.provider as keyof typeof providerSources] ?? "manual";
  const observations: BalancePoint[] = balances.filter(balance => balance.date <= currentDate);

  const currentBalanceIsObserved = observations.some(observation => observation.date === account.balance_date);

  if (account.balance_minor !== null && account.balance_date && account.balance_date <= currentDate && !currentBalanceIsObserved) {
    observations.push({
      date: account.balance_date,
      amount_minor: account.balance_minor,
      source,
      bank_balance_type: null
    });
  }

  observations.sort((left, right) => left.date.localeCompare(right.date));
  const latest = observations.at(-1);
  const opening = bookings.find(booking => booking.opening);
  const openingReference = opening ? {
    date: Temporal.PlainDate.from(bookings[0].date).subtract({
      days: 1
    }).toString(),
    amount_minor: 0,
    source: "transactions" as const,
    bank_balance_type: null
  } : undefined;
  const cashAccount = ["checking", "savings", "credit_card"].includes(account.kind);
  const explicitLedger = account.provider === "manual" && openingReference && observations.length === 0;
  const references = observations.slice();

  if (!references.length && openingReference) {
    references.push(openingReference);
  }

  const lastSyncDate = account.last_synced_at ? Temporal.Instant.from(account.last_synced_at).toZonedDateTimeISO(productTimeZone).toPlainDate().toString() : undefined;
  // A successful sync bounds coverage; stale bank data must not become a series of seemingly current daily balances.
  const lastCoverage = [latest?.date, bookings.at(-1)?.date, lastSyncDate].filter((date): date is string => Boolean(date)).sort().at(-1) ?? currentDate;
  const endDate = account.provider === "enable_banking" && lastCoverage < currentDate ? lastCoverage : currentDate;

  return {
    currency: account.currency,
    balances: bookings.length && references.length && (cashAccount || explicitLedger) ? dailyBalances(bookings, references, endDate) : balances
  };
}
