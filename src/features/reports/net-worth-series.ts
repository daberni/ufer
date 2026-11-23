import { Temporal } from "temporal-polyfill";
import { netWorthCategories, netWorthCategory, type NetWorthCategory } from "@/features/accounts/net-worth-categories";

/** An account's dated balances, oldest first, and the current balance that the net-worth figure counts. */
export type AccountBalanceSeries = {
  kind: string;
  currency: string;
  current_minor: number | null;
  balances: {
    date: string;
    amount_minor: number;
  }[];
};

/** Net worth on one date with its composition; the categories add up to the amount. */
export type NetWorthPoint = {
  date: string;
  amount_minor: number;
  categories: Record<NetWorthCategory, number>;
};

/** Monthly net-worth points in one currency; the last one is the current net worth. */
export type NetWorthHistory = {
  currency: string;
  points: NetWorthPoint[];
};

const historyMonths = 12;

/** The month ends before `endDate`, oldest first, followed by `endDate` itself. */
export function sampleDates(endDate: string) {
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

function pointOn(accounts: AccountBalanceSeries[], date: string, balance: (account: AccountBalanceSeries) => number): NetWorthPoint {
  const categories: Record<NetWorthCategory, number> = {
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0
  };

  for (const account of accounts) {
    const category = netWorthCategory(account.kind);

    if (category) {
      categories[category] += balance(account);
    }
  }

  return {
    date,
    amount_minor: netWorthCategories.reduce((total, category) => total + categories[category], 0),
    categories
  };
}

/** Sums the accounts in `currency` at each month end; the final point uses current balances so it matches the net-worth figure. */
export function netWorthSeries(accounts: AccountBalanceSeries[], currency: string, endDate: string): NetWorthPoint[] {
  const relevant = accounts.filter(account => account.currency === currency && netWorthCategory(account.kind));

  if (!relevant.length) {
    return [];
  }

  const dates = sampleDates(endDate);
  const past = dates.slice(0, -1).map(date => pointOn(relevant, date, account => balanceOn(account, date)));
  const current = pointOn(relevant, endDate, account => account.current_minor ?? 0);

  return [...past, current];
}

/** How net worth and each category changed from the first to the last point, and the month the first point falls in; null without two points. */
export type NetWorthChange = {
  since: string;
  amount_minor: number;
  categories: Record<NetWorthCategory, number>;
};

export function netWorthChange(points: NetWorthPoint[]): NetWorthChange | null {
  const first = points[0];
  const last = points.at(-1);

  if (!first || !last || points.length < 2) {
    return null;
  }

  return {
    since: first.date.slice(0, 7),
    amount_minor: last.amount_minor - first.amount_minor,
    categories: {
      liquidity: last.categories.liquidity - first.categories.liquidity,
      investments: last.categories.investments - first.categories.investments,
      property: last.categories.property - first.categories.property,
      liabilities: last.categories.liabilities - first.categories.liabilities
    }
  };
}
