import { database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import { bankingConfigured } from "@/features/banking/server/enable-banking-client";
import { currentMonth, periodToJson, trendMonths, type Period } from "@/features/dashboard/period";
import type { DashboardFilters } from "./dashboard-filters";

// Transaction lists, counts, cash flow and spending all use this condition so their results describe the same range.
function periodCondition(period: Period) {
  if (period.kind === "all") {
    return {
      sql: "TRUE",
      args: []
    };
  }

  return {
    sql: "substr(t.booking_date,1,7)=?",
    args: [period.month.toString()]
  };
}

export async function readDashboardState(filters: DashboardFilters) {
  const client = (await database()).$client;
  const env = environment();
  const {
    period,
    currency,
    page
  } = filters;
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
  const where = ["a.environment=?", "t.currency=?", inPeriod.sql];
  const args: (string | number)[] = [env, currency, ...inPeriod.args];

  if (filters.search) {
    where.push("instr(lower(t.counterparty || ' ' || t.description),lower(?)) > 0");
    args.push(filters.search);
  }

  if (filters.accountId) {
    where.push("a.id=?");
    args.push(filters.accountId);
  }

  if (filters.categoryId) {
    if (filters.categoryId === "uncategorized") {
      where.push("t.category_id IS NULL");
    } else {
      where.push("t.category_id=?");
      args.push(filters.categoryId);
    }
  }

  const transactionWhere = where.join(" AND ");
  const accountsQuery = client.execute({
    sql: `
      SELECT a.*,r.valid_until
      FROM accounts a
      LEFT JOIN requisitions r ON r.id=a.requisition_id
      WHERE a.environment=?
      ORDER BY CASE a.kind WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END,a.name
    `,
    args: [env]
  });
  const transactionsQuery = client.execute({
    sql: `
      SELECT t.*,a.name AS account_name,c.name AS category_name,c.color AS category_color,c.is_transfer
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      LEFT JOIN categories c ON c.id=t.category_id
      WHERE ${transactionWhere}
      ORDER BY t.booking_date DESC,t.created_at DESC,t.id
      LIMIT 50
      OFFSET ?
    `,
    args: [...args, (page - 1) * 50]
  });
  const countQuery = client.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM transactions t
      JOIN accounts a ON a.id=t.account_id
      WHERE ${transactionWhere}
    `,
    args
  });
  const categoriesQuery = client.execute("SELECT * FROM categories ORDER BY name");
  const rulesQuery = client.execute("SELECT r.*,c.name AS category_name,c.color AS category_color,c.icon AS category_icon FROM categorization_rules r JOIN categories c ON c.id=r.category_id ORDER BY priority,r.id");
  const connectionsQuery = client.execute({
    sql: `
      SELECT id,bank_name,bank_country,CASE WHEN status='PENDING'
      AND state_expires_at < ? THEN 'EXPIRED' WHEN status='LINKED'
      AND valid_until < ? THEN 'EXPIRED' ELSE status END AS status,valid_until,error,created_at
      FROM requisitions
      WHERE environment=?
      ORDER BY created_at DESC
      LIMIT 20
    `,
    args: [new Date().toISOString(), new Date().toISOString(), env]
  });
  const runsQuery = client.execute({
    sql: `
      SELECT *
      FROM sync_runs
      WHERE environment=?
      ORDER BY started_at DESC
      LIMIT 5
    `,
    args: [env]
  });
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
  const [accounts, transactions, count, categories, rules, connections, runs, flows, breakdown, trend] = await Promise.all([accountsQuery, transactionsQuery, countQuery, categoriesQuery, rulesQuery, connectionsQuery, runsQuery, flowsQuery, breakdownQuery, trendQuery]);
  const relevant = accounts.rows.filter(account => account.currency === currency);
  const sum = (kinds: string[]) => relevant.filter(account => kinds.includes(String(account.kind))).reduce((total, account) => total + Number(account.balance_minor || 0), 0);

  return {
    environment: env,
    bankingConfigured: bankingConfigured(),
    period: periodToJson(period),
    currency,
    page,
    accounts: accounts.rows,
    transactions: transactions.rows,
    transactionCount: Number(count.rows[0].n),
    categories: categories.rows,
    rules: rules.rows,
    connections: connections.rows,
    runs: runs.rows,
    summary: {
      netWorth: sum(["checking", "savings", "investment", "property", "credit_card", "loan"]),
      liquidity: sum(["checking", "savings", "credit_card"]),
      investments: sum(["investment"]),
      property: sum(["property"]),
      liabilities: sum(["loan"]),
      unvalued: relevant.filter(account => account.balance_minor === null).length,
      income: Number(flows.rows[0].income),
      expenses: Number(flows.rows[0].expenses)
    },
    breakdown: breakdown.rows,
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
