import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { currentMonth, periodToJson, trendMonths, type Period } from "@/features/dashboard/period";
import { periodCondition } from "./period-condition";

/** Income, expenses, spending by category and the six-month trend for one period and currency; categorized transfers are excluded. */
export async function readCashFlow(period: Period, currency: string) {
  const client = (await database()).$client;
  const env = environment();
  const inPeriod = periodCondition(period);
  const trendRange = trendMonths(period, currentMonth());
  const trendWindow = trendRange.map(month => month.toString());
  const firstDay = {
    day: 1
  };
  const trendStart = trendRange[0].toPlainDate(firstDay).toString();
  const trendEnd = trendRange[trendRange.length - 1].add({
    months: 1
  }).toPlainDate(firstDay).toString();
  const flowsQuery = client.execute({
    sql: `
      SELECT COALESCE(SUM(CASE WHEN t.amount_minor>0 THEN t.amount_minor ELSE 0 END),0) AS income, COALESCE(SUM(CASE WHEN t.amount_minor<0 THEN -t.amount_minor ELSE 0 END),0) AS expenses
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id
      WHERE a.environment=?
      AND t.currency=?
      AND ${inPeriod.sql}
      AND COALESCE(c.is_transfer,0)=0
    `,
    args: [env, currency, ...inPeriod.args]
  });
  const breakdownQuery = client.execute({
    sql: `
      SELECT COALESCE(c.name,'Uncategorized') AS name,COALESCE(c.color,'#a2aaa5') AS color,c.icon AS icon,SUM(-t.amount_minor) AS amount
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id
      WHERE a.environment=?
      AND t.currency=?
      AND ${inPeriod.sql}
      AND t.amount_minor<0
      AND COALESCE(c.is_transfer,0)=0
      GROUP BY t.category_id
      ORDER BY amount DESC
    `,
    args: [env, currency, ...inPeriod.args]
  });
  const trendQuery = client.execute({
    sql: `
      SELECT substr(t.booking_date,1,7) AS month,SUM(CASE WHEN amount_minor>0 THEN amount_minor ELSE 0 END) AS income,SUM(CASE WHEN amount_minor<0 THEN -amount_minor ELSE 0 END) AS expenses
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id
      WHERE a.environment=?
      AND t.currency=?
      AND t.booking_date>=?
      AND t.booking_date<?
      AND COALESCE(c.is_transfer,0)=0
      GROUP BY substr(t.booking_date,1,7)
    `,
    args: [env, currency, trendStart, trendEnd]
  });
  const [flows, breakdown, trend] = await Promise.all([flowsQuery, breakdownQuery, trendQuery]);

  return {
    period: periodToJson(period),
    currency,
    income: Number(flows.rows[0].income),
    expenses: Number(flows.rows[0].expenses),
    breakdown: breakdown.rows.map(row => ({
      name: String(row.name),
      color: String(row.color),
      icon: row.icon === null ? null : String(row.icon),
      amount: Number(row.amount)
    })),
    trend: trendWindow.map(month => {
      const row = trend.rows.find(item => item.month === month);

      return {
        month,
        income: Number(row?.income || 0),
        expenses: Number(row?.expenses || 0)
      };
    })
  };
}
