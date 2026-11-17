import type { InValue } from "@libsql/client";
import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { currentMonth, periodToJson, trendMonths, type Period } from "@/lib/period";
import type { CategoryAmount } from "@/features/reports/types";
import { periodCondition } from "@/features/transactions/server/period-condition";

type SqlCondition = {
  sql: string;
  args: InValue[];
};

const bookingMonth = "substr(t.booking_date,1,7)";

/**
 * Transactions that count toward cash flow and spending in a date range: income and expenses of this environment and currency. Transfers, opening balances and adjustments never count, whatever their category. Every cash-flow figure reads through this one definition so totals, breakdowns and the trend agree.
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
      AND t.type IN ('income','expense')
    `,
    args: [environment(), currency, ...range.args]
  };
}

type Flow = "income" | "expenses";

/** Which transactions make up each flow and the amount each contributes. A refund is an expense with a positive amount, so it reduces spending. */
const flows: Record<Flow, {
  condition: string;
  amount: string;
}> = {
  income: {
    condition: "t.type='income'",
    amount: "t.amount_minor"
  },
  expenses: {
    condition: "t.type='expense'",
    amount: "-t.amount_minor"
  }
};

function flowTotal(flow: Flow) {
  return `COALESCE(SUM(CASE WHEN ${flows[flow].condition} THEN ${flows[flow].amount} ELSE 0 END),0)`;
}

/**
 * Amounts per category of one flow among counted transactions, largest first, with uncategorized transactions as one row. Per month, rows are also split by booking month.
 * A category whose refunds reach or exceed its spending has no row; its net amount still counts toward the flow's total.
 */
function flowByCategory(source: SqlCondition, flow: Flow, perMonth: boolean): SqlCondition {
  const month = perMonth ? bookingMonth : "NULL";
  const grouping = perMonth ? `${bookingMonth},t.category_id` : "t.category_id";

  return {
    sql: `
      SELECT ${month} AS month,t.category_id AS category_id,COALESCE(c.name,'Uncategorized') AS name,COALESCE(c.color,'#a2aaa5') AS color,c.icon AS icon,SUM(${flows[flow].amount}) AS amount
      ${source.sql}
      AND ${flows[flow].condition}
      GROUP BY ${grouping}
      HAVING amount>0
      ORDER BY month,amount DESC,name
    `,
    args: source.args
  };
}

function categoryAmount(row: Record<string, unknown>): CategoryAmount {
  return {
    categoryId: row.category_id === null ? null : String(row.category_id),
    name: String(row.name),
    color: String(row.color),
    icon: row.icon === null ? null : String(row.icon),
    amount: Number(row.amount)
  };
}

/** Income, expenses, spending by category and the six-month trend, including each month's income and spending by category, for one period and currency. */
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
  const totalsQuery = client.execute({
    sql: `
      SELECT ${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses
      ${inPeriod.sql}
    `,
    args: inPeriod.args
  });
  const breakdownQuery = client.execute(flowByCategory(inPeriod, "expenses", false));
  const trendQuery = client.execute({
    sql: `
      SELECT ${bookingMonth} AS month,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses
      ${inTrend.sql}
      GROUP BY ${bookingMonth}
    `,
    args: inTrend.args
  });
  const trendIncomeQuery = client.execute(flowByCategory(inTrend, "income", true));
  const trendExpensesQuery = client.execute(flowByCategory(inTrend, "expenses", true));
  const [totals, breakdown, trend, trendIncome, trendExpenses] = await Promise.all([totalsQuery, breakdownQuery, trendQuery, trendIncomeQuery, trendExpensesQuery]);

  return {
    period: periodToJson(period),
    currency,
    income: Number(totals.rows[0].income),
    expenses: Number(totals.rows[0].expenses),
    breakdown: breakdown.rows.map(categoryAmount),
    trend: trendWindow.map(month => {
      const row = trend.rows.find(item => item.month === month);

      return {
        month,
        income: Number(row?.income || 0),
        expenses: Number(row?.expenses || 0),
        incomeBreakdown: trendIncome.rows.filter(item => item.month === month).map(categoryAmount),
        expenseBreakdown: trendExpenses.rows.filter(item => item.month === month).map(categoryAmount)
      };
    })
  };
}
