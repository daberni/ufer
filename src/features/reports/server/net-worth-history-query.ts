import { listAccounts, readBalanceHistory, netWorthKinds } from "@/features/accounts/server/account-queries";
import { today } from "@/lib/time";
import { netWorthSeries, type NetWorthHistory } from "@/features/reports/net-worth-series";

/** Monthly net worth over the last year from the same accounts and balances as the current net-worth figure. */
export async function readNetWorthHistory(currency: string): Promise<NetWorthHistory> {
  const relevant = (await listAccounts()).filter(account => account.currency === currency && netWorthKinds.includes(account.kind));
  const accounts = await Promise.all(relevant.map(async account => ({
    currency: account.currency,
    current_minor: account.balance_minor,
    balances: (await readBalanceHistory(account.id)).balances
  })));

  return {
    currency,
    points: netWorthSeries(accounts, currency, today().toString())
  };
}
