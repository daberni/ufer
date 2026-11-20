import { Temporal } from "temporal-polyfill";

/** An account's dated balances, oldest first, and the current balance that the net-worth figure counts. */
export type AccountBalanceSeries = {
  currency: string;
  current_minor: number | null;
  balances: {
    date: string;
    amount_minor: number;
  }[];
};

export type NetWorthPoint = {
  date: string;
  amount_minor: number;
};

/** Monthly net-worth points in one currency; the last one is the current net worth. */
export type NetWorthHistory = {
  currency: string;
  points: NetWorthPoint[];
};

const historyMonths = 12;

/** The month ends before `endDate`, oldest first, followed by `endDate` itself. */
function sampleDates(endDate: string) {
  const end = Temporal.PlainDate.from(endDate);
  const dates: string[] = [];

  for (let offset = historyMonths - 1; offset >= 1; offset -= 1) {
    const month = end.toPlainYearMonth().subtract({
      months: offset
    });

    dates.push(month.toPlainDate({
      day: month.daysInMonth
    }).toString());
  }

  dates.push(endDate);

  return dates;
}

// An account counts only from its first known balance; earlier months do not assume it already existed.
function balanceOn(account: AccountBalanceSeries, date: string) {
  return account.balances.filter(balance => balance.date <= date).at(-1)?.amount_minor ?? 0;
}

/** Sums the accounts in `currency` at each month end; the final point uses current balances so it matches the net-worth figure. */
export function netWorthSeries(accounts: AccountBalanceSeries[], currency: string, endDate: string): NetWorthPoint[] {
  const relevant = accounts.filter(account => account.currency === currency);

  if (!relevant.length) {
    return [];
  }

  const dates = sampleDates(endDate);
  const past = dates.slice(0, -1).map(date => ({
    date,
    amount_minor: relevant.reduce((total, account) => total + balanceOn(account, date), 0)
  }));
  const current = {
    date: endDate,
    amount_minor: relevant.reduce((total, account) => total + (account.current_minor ?? 0), 0)
  };

  return [...past, current];
}
