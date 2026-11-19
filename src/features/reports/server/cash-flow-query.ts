import type { InValue } from "@libsql/client";
import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { currentMonth, periodToJson, trendMonths, type Period } from "@/lib/period";
import { HttpError } from "@/lib/errors";
import type { AccountCashFlow, CategoryAmount } from "@/features/reports/types";
import { periodCondition } from "@/features/transactions/server/period-condition";

type SqlCondition = {
  sql: string;
  args: InValue[];
};

const bookingMonth = "substr(t.booking_date,1,7)";

/**
 * Transactions that count toward cash flow and spending in a date range: visible income and expenses of this environment and currency. Transfers, opening balances, adjustments and hidden bookings never count, whatever their category. Every cash-flow figure reads through this one definition so totals, breakdowns and the trend agree.
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
      AND t.suppressed_at IS NULL
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
 * A category with a negative net amount, such as an income correction or refunds exceeding spending, keeps a signed row, so the rows always sum to the flow's total; only categories netting to zero are left out.
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
      HAVING amount<>0
      ORDER BY month,amount DESC,name
    `,
    args: source.args
  };
}

function monthTotals(rows: Record<string, unknown>[], month: string) {
  const row = rows.find(item => item.month === month);

  return {
    month,
    income: Number(row?.income || 0),
    expenses: Number(row?.expenses || 0)
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

/** Income, expenses, both by category, and the twelve-month trend with the totals of the month before it, including each month's income and spending by category, for one period and currency. */
export async function readCashFlow(period: Period, currency: string) {
  const client = (await database()).$client;
  const trendRange = trendMonths(period, currentMonth());
  const trendWindow = trendRange.map(month => month.toString());
  const firstDay = {
    day: 1
  };
  const trendStart = trendRange[0].toPlainDate(firstDay).toString();
  // The month before the trend only continues the chart's net area to its left edge.
  const leadMonth = trendRange[0].subtract({
    months: 1
  });
  const leadStart = leadMonth.toPlainDate(firstDay).toString();
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
  const incomeBreakdownQuery = client.execute(flowByCategory(inPeriod, "income", false));
  const expenseBreakdownQuery = client.execute(flowByCategory(inPeriod, "expenses", false));
  const totalsByMonth = countedTransactions(currency, {
    sql: "t.booking_date>=? AND t.booking_date<?",
    args: [leadStart, trendEnd]
  });
  const trendQuery = client.execute({
    sql: `
      SELECT ${bookingMonth} AS month,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses
      ${totalsByMonth.sql}
      GROUP BY ${bookingMonth}
    `,
    args: totalsByMonth.args
  });
  const trendIncomeQuery = client.execute(flowByCategory(inTrend, "income", true));
  const trendExpensesQuery = client.execute(flowByCategory(inTrend, "expenses", true));
  const [totals, incomeBreakdown, expenseBreakdown, trend, trendIncome, trendExpenses] = await Promise.all([totalsQuery, incomeBreakdownQuery, expenseBreakdownQuery, trendQuery, trendIncomeQuery, trendExpensesQuery]);

  return {
    period: periodToJson(period),
    currency,
    income: Number(totals.rows[0].income),
    expenses: Number(totals.rows[0].expenses),
    incomeBreakdown: incomeBreakdown.rows.map(categoryAmount),
    expenseBreakdown: expenseBreakdown.rows.map(categoryAmount),
    leadIn: monthTotals(trend.rows, leadMonth.toString()),
    trend: trendWindow.map(month => {
      return {
        ...monthTotals(trend.rows, month),
        incomeBreakdown: trendIncome.rows.filter(item => item.month === month).map(categoryAmount),
        expenseBreakdown: trendExpenses.rows.filter(item => item.month === month).map(categoryAmount)
      };
    })
  };
}

function accountTransferTotal(direction: "incoming" | "outgoing") {
  const positive = direction === "incoming";
  const sign = positive ? ">" : "<";
  const amount = positive ? "t.amount_minor" : "-t.amount_minor";

  return `COALESCE(SUM(CASE WHEN t.type='transfer' AND t.amount_minor${sign}0 THEN ${amount} ELSE 0 END),0)`;
}

/** One account's income, expenses and transfers in a period, from its transactions in the account's own currency. */
export async function readAccountCashFlow(accountId: string, period: Period): Promise<AccountCashFlow> {
  const client = (await database()).$client;
  const inPeriod = periodCondition(period);
  const result = await client.execute({
    sql: `
      SELECT a.currency AS currency,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses,${accountTransferTotal("incoming")} AS transfers_in,${accountTransferTotal("outgoing")} AS transfers_out
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id=a.id AND t.currency=a.currency AND t.suppressed_at IS NULL AND ${inPeriod.sql}
      WHERE a.id=?
      AND a.environment=?
      GROUP BY a.id
    `,
    args: [...inPeriod.args, accountId, environment()]
  });
  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "Account not found.");
  }

  return {
    period: periodToJson(period),
    currency: String(row.currency),
    income: Number(row.income),
    expenses: Number(row.expenses),
    transfersIn: Number(row.transfers_in),
    transfersOut: Number(row.transfers_out)
  };
}
