import { sql, type SQL } from "drizzle-orm";
import { database } from "@/server/database/connection";
import { currentMonth, periodToJson, trendMonths, type Period } from "@/lib/period";
import { HttpError } from "@/lib/errors";
import type { AccountCashFlow, CategoryAmount } from "@/features/reports/types";
import { dateRangeCondition, periodCondition } from "@/features/transactions/server/period-condition";

type Row = Record<string, unknown>;

const bookingMonth = sql.raw("substr(t.date,1,7)");

/**
 * The amounts reports count, one row per booking or part: an unsplit booking with its category, each part of a split booking with the part's category, and, when a split booking's amount changed after splitting, the difference as an uncategorized row. Every booking thus counts exactly once with its full amount, and balances keep reading the bookings themselves.
 */
const countedLines = sql.raw(`(
  SELECT t.account_id,t.currency,t.date,t.type,t.suppressed_at,t.category_id,t.amount_minor
  FROM transactions t
  WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)
  UNION ALL
  SELECT t.account_id,t.currency,t.date,t.type,t.suppressed_at,s.category_id,s.amount_minor
  FROM transaction_splits s
  JOIN transactions t ON t.id=s.transaction_id
  UNION ALL
  SELECT t.account_id,t.currency,t.date,t.type,t.suppressed_at,NULL,t.amount_minor-SUM(s.amount_minor)
  FROM transaction_splits s
  JOIN transactions t ON t.id=s.transaction_id
  GROUP BY t.id
  HAVING SUM(s.amount_minor)<>t.amount_minor
)`);

/** Counted lines in a date range: hidden bookings never count. Flows then select the types they cover. */
function countedIn(range: SQL) {
  return sql`t.suppressed_at IS NULL AND ${range}`;
}

/**
 * Transactions that count toward cash flow and spending in a date range: visible income and expenses in one currency. Transfers, opening balances, adjustments and hidden bookings never count, whatever their category. A split booking counts as its parts. Every cash-flow figure reads through this one definition so totals, breakdowns and the trend agree.
 */
function countedTransactions(currency: string, range: SQL) {
  return sql`
    FROM ${countedLines} t
    JOIN accounts a ON a.id=t.account_id
    LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.currency=${currency}
    AND ${countedIn(range)}
    AND t.type IN ('income','expense')
  `;
}

type Flow = "income" | "expenses";

/** Which transactions make up each flow and the amount each contributes. A refund is an expense with a positive amount, so it reduces spending. */
const flows: Record<Flow, {
  condition: SQL;
  amount: SQL;
}> = {
  income: {
    condition: sql.raw("t.type='income'"),
    amount: sql.raw("t.amount_minor")
  },
  expenses: {
    condition: sql.raw("t.type='expense'"),
    amount: sql.raw("-t.amount_minor")
  }
};

function flowTotal(flow: Flow) {
  return sql`COALESCE(SUM(CASE WHEN ${flows[flow].condition} THEN ${flows[flow].amount} ELSE 0 END),0)`;
}

/**
 * Amounts per category of one flow among counted transactions, largest first, with uncategorized transactions as one row. Per month, rows are also split by booking month.
 * A category with a negative net amount, such as an income correction or refunds exceeding spending, keeps a signed row, so the rows always sum to the flow's total; only categories netting to zero are left out.
 */
function flowByCategory(source: SQL, flow: Flow, perMonth: boolean) {
  const month = perMonth ? bookingMonth : sql.raw("NULL");
  const grouping = perMonth ? sql`${bookingMonth},t.category_id` : sql.raw("t.category_id");

  return sql`
    SELECT ${month} AS month,t.category_id AS category_id,COALESCE(c.name,'Uncategorized') AS name,COALESCE(c.color,'#a2aaa5') AS color,c.icon AS icon,SUM(${flows[flow].amount}) AS amount
    ${source}
    AND ${flows[flow].condition}
    GROUP BY ${grouping}
    HAVING amount<>0
    ORDER BY month,amount DESC,name
  `;
}

function monthTotals(rows: Row[], month: string) {
  const row = rows.find(item => item.month === month);

  return {
    month,
    income: Number(row?.income || 0),
    expenses: Number(row?.expenses || 0)
  };
}

function categoryAmount(row: Row): CategoryAmount {
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
  const db = await database();
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
  const inTrend = countedTransactions(currency, dateRangeCondition(trendStart, trendEnd));
  const totalsByMonth = countedTransactions(currency, dateRangeCondition(leadStart, trendEnd));
  const totalsQuery = db.all<Row>(sql`SELECT ${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses ${inPeriod}`);
  const incomeBreakdownQuery = db.all<Row>(flowByCategory(inPeriod, "income", false));
  const expenseBreakdownQuery = db.all<Row>(flowByCategory(inPeriod, "expenses", false));
  const trendQuery = db.all<Row>(sql`SELECT ${bookingMonth} AS month,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses ${totalsByMonth} GROUP BY ${bookingMonth}`);
  const trendIncomeQuery = db.all<Row>(flowByCategory(inTrend, "income", true));
  const trendExpensesQuery = db.all<Row>(flowByCategory(inTrend, "expenses", true));
  const [totals, incomeBreakdown, expenseBreakdown, trend, trendIncome, trendExpenses] = await Promise.all([totalsQuery, incomeBreakdownQuery, expenseBreakdownQuery, trendQuery, trendIncomeQuery, trendExpensesQuery]);

  return {
    period: periodToJson(period),
    currency,
    income: Number(totals[0].income),
    expenses: Number(totals[0].expenses),
    incomeBreakdown: incomeBreakdown.map(categoryAmount),
    expenseBreakdown: expenseBreakdown.map(categoryAmount),
    leadIn: monthTotals(trend, leadMonth.toString()),
    trend: trendWindow.map(month => {
      return {
        ...monthTotals(trend, month),
        incomeBreakdown: trendIncome.filter(item => item.month === month).map(categoryAmount),
        expenseBreakdown: trendExpenses.filter(item => item.month === month).map(categoryAmount)
      };
    })
  };
}

function accountTransferTotal(direction: "incoming" | "outgoing") {
  const condition = direction === "incoming" ? sql.raw("t.amount_minor>0") : sql.raw("t.amount_minor<0");
  const amount = direction === "incoming" ? sql.raw("t.amount_minor") : sql.raw("-t.amount_minor");

  return sql`COALESCE(SUM(CASE WHEN t.type='transfer' AND ${condition} THEN ${amount} ELSE 0 END),0)`;
}

/** One account's income, expenses and transfers in a period, from its counted lines in the account's own currency, so its income and expenses agree with the overview's. */
export async function readAccountCashFlow(accountId: string, period: Period): Promise<AccountCashFlow> {
  const db = await database();
  const [row] = await db.all<Row>(sql`
    SELECT a.currency AS currency,${flowTotal("income")} AS income,${flowTotal("expenses")} AS expenses,${accountTransferTotal("incoming")} AS transfers_in,${accountTransferTotal("outgoing")} AS transfers_out
    FROM accounts a
    LEFT JOIN ${countedLines} t ON t.account_id=a.id AND t.currency=a.currency AND ${countedIn(periodCondition(period))}
    WHERE a.id=${accountId}
    GROUP BY a.id
  `);

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
