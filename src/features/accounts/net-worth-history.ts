import { Temporal } from "temporal-polyfill";
import { wealthGroups, type AccountKind } from "@/features/accounts/account-kinds";
import type { Period } from "@/lib/period";
import type { BalancePoint, NetWorthPoint } from "@/features/accounts/types";

type RecordedBalance = BalancePoint & {
  source: "sync" | "manual" | "csv";
};

/** One account's recorded valuations, oldest first; reconstructed daily estimates do not establish monthly observation provenance. */
export type AccountBalances = {
  kind: AccountKind;
  balances: RecordedBalance[];
};

// A month period shows the year up to the selected month.
const monthsShown = 12;

const sourceCounts: Record<RecordedBalance["source"], "synced" | "manual" | "imported"> = {
  sync: "synced",
  manual: "manual",
  csv: "imported"
};

function earliestMonth(accounts: AccountBalances[]) {
  const dates = accounts.flatMap(account => account.balances.slice(0, 1).map(balance => balance.date));

  if (!dates.length) {
    return null;
  }

  return Temporal.PlainYearMonth.from(dates.toSorted()[0].slice(0, 7));
}

/** Months shown for a period, oldest first: up to a year ending at the selected month, or every month since the first balance. Months before the first balance and after the current month are left out. */
function shownMonths(accounts: AccountBalances[], period: Period, current: Temporal.PlainYearMonth) {
  const first = earliestMonth(accounts);

  if (!first) {
    return [];
  }

  const selectedEnd = period.kind === "month" && Temporal.PlainYearMonth.compare(period.month, current) < 0 ? period.month : current;
  const windowStart = period.kind === "month" ? selectedEnd.subtract({
    months: monthsShown - 1
  }) : first;
  const months: Temporal.PlainYearMonth[] = [];
  let month = Temporal.PlainYearMonth.compare(windowStart, first) < 0 ? first : windowStart;

  while (Temporal.PlainYearMonth.compare(month, selectedEnd) <= 0) {
    months.push(month);
    month = month.add({
      months: 1
    });
  }

  return months;
}

function pointAt(month: Temporal.PlainYearMonth, accounts: AccountBalances[], today: Temporal.PlainDate): NetWorthPoint {
  const monthEnd = month.toPlainDate({
    day: month.daysInMonth
  });
  const date = (Temporal.PlainDate.compare(monthEnd, today) > 0 ? today : monthEnd).toString();
  const monthStart = month.toPlainDate({
    day: 1
  }).toString();
  const point: NetWorthPoint = {
    month: month.toString(),
    date,
    netWorth: 0,
    liquidity: 0,
    investments: 0,
    property: 0,
    liabilities: 0,
    synced: 0,
    manual: 0,
    imported: 0,
    carried: 0,
    unvalued: 0
  };

  for (const account of accounts) {
    const balance = account.balances.findLast(entry => entry.date <= date);

    if (!balance) {
      point.unvalued += 1;
      continue;
    }

    point.netWorth += balance.amount_minor;
    point[wealthGroups[account.kind]] += balance.amount_minor;
    point[sourceCounts[balance.source]] += 1;

    if (balance.date < monthStart) {
      point.carried += 1;
    }
  }

  return point;
}

/**
 * Net worth at the end of each shown month from every account's latest balance on or before that day; the current month uses today, so its point matches the latest known balances. A balance recorded in an earlier month is carried forward and counted, never interpolated.
 */
export function projectNetWorthHistory(accounts: AccountBalances[], period: Period, today: Temporal.PlainDate): NetWorthPoint[] {
  return shownMonths(accounts, period, today.toPlainYearMonth()).map(month => pointAt(month, accounts, today));
}
