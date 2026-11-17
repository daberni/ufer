import { and, asc, eq, sql } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { accounts, balanceSnapshots, requisitions } from "@/server/database/schema";
import { environment } from "@/features/banking/server/environment";
import { HttpError } from "@/lib/errors";
import { periodToJson, type Period } from "@/lib/period";
import { today } from "@/lib/time";
import { wealthGroups, type WealthGroup } from "@/features/accounts/account-kinds";
import { projectNetWorthHistory, type AccountBalances } from "@/features/accounts/net-worth-history";
import type { BalanceHistory, NetWorthHistory } from "@/features/accounts/types";

const kindOrder = sql`CASE ${accounts.kind} WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END`;

/** Accounts of the current banking environment with their latest balance and, for bank accounts, the authorization expiry. */
export async function listAccounts() {
  const db = await database();

  return db.select({
    id: accounts.id,
    name: accounts.name,
    institution: accounts.institution,
    kind: accounts.kind,
    currency: accounts.currency,
    balance_minor: accounts.balance_minor,
    balance_date: accounts.balance_date,
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
  const sum = (group?: WealthGroup) => relevant.filter(account => !group || wealthGroups[account.kind] === group).reduce((total, account) => total + (account.balance_minor ?? 0), 0);

  return {
    currency,
    netWorth: sum(),
    liquidity: sum("liquidity"),
    investments: sum("investments"),
    property: sum("property"),
    liabilities: sum("liabilities"),
    unvalued: relevant.filter(account => account.balance_minor === null).length
  };
}

/** Every recorded balance of one account of the current banking environment, oldest first. */
export async function readBalanceHistory(accountId: string): Promise<BalanceHistory> {
  const db = await database();
  const account = await db.select({
    currency: accounts.currency
  }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.environment, environment()))).get();

  if (!account) {
    throw new HttpError(404, "Account not found.");
  }

  const balances = await db.select({
    date: balanceSnapshots.observed_at,
    amount_minor: balanceSnapshots.amount_minor,
    source: balanceSnapshots.source
  }).from(balanceSnapshots).where(eq(balanceSnapshots.account_id, accountId)).orderBy(asc(balanceSnapshots.observed_at));

  return {
    currency: account.currency,
    balances
  };
}

/** Monthly net worth of the current banking environment's accounts in one currency, from their recorded balances. */
export async function readNetWorthHistory(period: Period, currency: string): Promise<NetWorthHistory> {
  const db = await database();
  const rows = await db.select({
    id: accounts.id,
    kind: accounts.kind,
    date: balanceSnapshots.observed_at,
    amount_minor: balanceSnapshots.amount_minor,
    source: balanceSnapshots.source
  }).from(accounts).leftJoin(balanceSnapshots, eq(balanceSnapshots.account_id, accounts.id)).where(and(eq(accounts.environment, environment()), eq(accounts.currency, currency))).orderBy(asc(accounts.id), asc(balanceSnapshots.observed_at));
  const byAccount = new Map<string, AccountBalances>();

  for (const row of rows) {
    let account = byAccount.get(row.id);

    if (!account) {
      account = {
        kind: row.kind,
        balances: []
      };
      byAccount.set(row.id, account);
    }

    // An account without any balance still counts as unvalued.
    if (row.date !== null && row.amount_minor !== null && row.source !== null) {
      account.balances.push({
        date: row.date,
        amount_minor: row.amount_minor,
        source: row.source
      });
    }
  }

  return {
    period: periodToJson(period),
    currency,
    points: projectNetWorthHistory([...byAccount.values()], period, today())
  };
}
