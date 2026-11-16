import type { InValue } from "@libsql/client";
import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { currentMonth, periodToJson, trendMonths, type Period } from "@/features/dashboard/period";
import type { SpendingItem } from "@/features/dashboard/types";
import { periodCondition } from "./period-condition";

type SqlCondition = {
  sql: string;
  args: InValue[];
};

const bookingMonth = "substr(t.booking_date,1,7)";

/**
 * Transactions that count toward cash flow and spending in a date range: this environment and currency, without categorized transfers. Every cash-flow figure reads through this one definition so totals, breakdowns and the trend agree.
 */
function countedTransactions(currency: string, range: SqlCondition): SqlCondition {
  return {
    sql: `
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id
      WHERE a.environment=?
      AND t.currency=?
      AND ${range.sql}
      AND COALESCE(c.is_transfer,0)=0
    `,
    args: [environment(), currency, ...range.args]
  };
}

/** Spending per category among counted transactions, largest first, with uncategorized spending as one row. Per month, rows are also split by booking month. */
function spendingByCategory(source: SqlCondition, perMonth: boolean): SqlCondition {
  const month = perMonth ? bookingMonth : "NULL";
  const grouping = perMonth ? `${bookingMonth},t.category_id` : "t.category_id";

  return {
    sql: `
      SELECT ${month} AS month,t.category_id AS category_id,COALESCE(c.name,'Uncategorized') AS name,COALESCE(c.color,'#a2aaa5') AS color,c.icon AS icon,SUM(-t.amount_minor) AS amount
      ${source.sql}
      AND t.amount_minor<0
      GROUP BY ${grouping}
      ORDER BY month,amount DESC,name
    `,
    args: source.args
  };
}

function spendingItem(row: Record<string, unknown>): SpendingItem {
  return {
    categoryId: row.category_id === null ? null : String(row.category_id),
    name: String(row.name),
    color: String(row.color),
    icon: row.icon === null ? null : String(row.icon),
    amount: Number(row.amount)
  };
}

/** Income, expenses, spending by category and the six-month trend, including each month's spending by category, for one period and currency. */
export async function readCashFlow(period: Period, currency: string) {
  const client = (await database()).$client;
  const trendRange = trendMonths(period, currentMonth());
  const trendWindow = trendRange.map(month => month.toString());
  const firstDay = {
    day: 1
  };
  const trendStart = trendRange[0].toPlainDate(firstDay).toString();
  const trendEnd = trendRange[trendRange.length - 1].add({
    months: 1
  }).toPlainDate(firstDay).toString();
  const inPeriod = countedTransactions(currency, periodCondition(period));
  const inTrend = countedTransactions(currency, {
    sql: "t.booking_date>=? AND t.booking_date<?",
    args: [trendStart, trendEnd]
  });
  const flowsQuery = client.execute({
    sql: `
      SELECT COALESCE(SUM(CASE WHEN t.amount_minor>0 THEN t.amount_minor ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN t.amount_minor<0 THEN -t.amount_minor ELSE 0 END),0) AS expenses
      ${inPeriod.sql}
    `,
    args: inPeriod.args
  });
  const breakdownQuery = client.execute(spendingByCategory(inPeriod, false));
  const trendQuery = client.execute({
    sql: `
      SELECT ${bookingMonth} AS month,SUM(CASE WHEN t.amount_minor>0 THEN t.amount_minor ELSE 0 END) AS income,SUM(CASE WHEN t.amount_minor<0 THEN -t.amount_minor ELSE 0 END) AS expenses
      ${inTrend.sql}
      GROUP BY ${bookingMonth}
    `,
    args: inTrend.args
  });
  const trendBreakdownQuery = client.execute(spendingByCategory(inTrend, true));
  const [flows, breakdown, trend, trendBreakdown] = await Promise.all([flowsQuery, breakdownQuery, trendQuery, trendBreakdownQuery]);

  return {
    period: periodToJson(period),
    currency,
    income: Number(flows.rows[0].income),
    expenses: Number(flows.rows[0].expenses),
    breakdown: breakdown.rows.map(spendingItem),
    trend: trendWindow.map(month => {
      const row = trend.rows.find(item => item.month === month);

      return {
        month,
        income: Number(row?.income || 0),
        expenses: Number(row?.expenses || 0),
        breakdown: trendBreakdown.rows.filter(item => item.month === month).map(spendingItem)
      };
    })
  };
}
