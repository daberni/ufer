import { Temporal } from "temporal-polyfill";
import { listAccounts, readBalanceHistory, readBrokerageValuations } from "@/features/accounts/server/account-queries";
import { netWorthCategory } from "@/features/accounts/net-worth-categories";
import { today } from "@/lib/time";
import { netWorthSeries, sampleDates, type NetWorthHistory } from "@/features/reports/net-worth-series";

/** Monthly net worth over the last year from the same accounts and balances as the current net-worth figure. */
export async function readNetWorthHistory(currency: string, now = Temporal.Now.instant()): Promise<NetWorthHistory> {
  const endDate = today(now).toString();
  const relevant = (await listAccounts(now)).filter(account => account.currency === currency && netWorthCategory(account.kind) !== null);
  // A brokerage account is valued only on the sampled dates instead of on every date its daily history changes.
  const valuations = await readBrokerageValuations(relevant.filter(account => account.kind === "brokerage").map(account => account.id), sampleDates(endDate));
  const accounts = await Promise.all(relevant.map(async account => ({
    kind: account.kind,
    currency: account.currency,
    current_minor: account.balance_minor,
    balances: valuations.get(account.id) ?? (await readBalanceHistory(account.id, now)).balances
  })));

  return {
    currency,
    points: netWorthSeries(accounts, currency, endDate)
  };
}
