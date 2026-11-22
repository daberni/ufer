import { eq, sql, type SQL } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { accounts, transactions } from "@/server/database/schema";
import { syncRunTransactions } from "@/features/transactions/server/sync-run-transactions";
import { periodToJson } from "@/lib/period";
import { transactionPageSize } from "@/lib/pagination";
import { periodCondition } from "@/features/transactions/server/period-condition";
import { searchCondition } from "@/features/transactions/server/search-condition";
import type { DashboardFilters } from "@/server/http/dashboard-filters";
import type { TransactionType } from "@/lib/transaction-types";
import { createdCounterpartPrefix, manualEntryPrefix } from "@/lib/booking-references";
import { listRules } from "@/features/categorization/server/rule-repository";
import { prepareRules, ruleAssignment, type PreparedRule } from "@/features/categorization/server/rule-assignment";
import type { SplitPart, Transaction, TransactionSplit } from "@/features/transactions/types";
import { readSplitParts } from "@/features/transactions/server/split-repository";

// Mirrors `enteredInUfer` for a booking and its account in the list's SQL.
function enteredColumn(booking: string, account: string) {
  return sql.raw(`((${account}.provider='manual' AND (${booking}.provider_reference LIKE '${manualEntryPrefix}%' OR ${booking}.provider_reference LIKE '${createdCounterpartPrefix}%')) OR (${account}.provider<>'manual' AND ${booking}.provider_reference LIKE '${manualEntryPrefix}%' AND ${booking}.type IN ('opening_balance','adjustment')))`);
}

/** Whether a listed booking was entered in Ufer and, if so, whether it follows a linked imported booking. A counterpart created for an imported booking is not editable as an entry. */
function entryState(row: Record<string, unknown>) {
  const linkedToImport = row.counterpart_id !== null && !row.counterpart_entered;
  const entered = Boolean(row.entered) && !(Boolean(row.created_counterpart) && linkedToImport);

  return {
    entered,
    follows_import: entered && linkedToImport
  };
}

/** What the rules would assign a manually categorized row, which it can return to; null for a rule-assigned row. Rules match the source text and the text with the overrides applied. */
function automaticAssignment(row: Record<string, unknown>, rules: PreparedRule[] | null) {
  if (row.category_source !== "manual" || !rules) {
    return null;
  }

  const assignment = ruleAssignment({
    account_id: String(row.account_id),
    counterparty: String(row.source_counterparty),
    description: String(row.source_description),
    counterparty_override: row.counterparty_override == null ? null : String(row.counterparty_override),
    description_override: row.description_override == null ? null : String(row.description_override)
  }, rules);

  return {
    category_id: assignment.categoryId,
    rule_id: assignment.ruleId
  };
}

/** Matches what reports count as uncategorized: an unsplit booking without a category, a split with an uncategorized part, or a split whose parts no longer add up to the booking. */
const uncategorizedCondition = sql.raw(`t.category_id IS NULL AND (
  NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)
  OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND s.category_id IS NULL)
  OR (SELECT SUM(s.amount_minor) FROM transaction_splits s WHERE s.transaction_id=t.id)<>t.amount_minor
)`);

function splitOf(parts: SplitPart[] | undefined, amount: number): TransactionSplit | null {
  if (!parts) {
    return null;
  }

  const total = parts.reduce((sum, part) => sum + part.amount_minor, 0);

  return {
    parts,
    balanced: total === amount
  };
}

/** The sync run a list is filtered to, resolved by its owner; its start identifies the rows it inserted. */
type ListedSyncRun = {
  started_at: string;
};

/**
 * The transactions a list shows before search and filters: those a sync run inserted, in any month and currency, or otherwise the selected period in the display currency.
 */
function listScope(db: Database, filters: DashboardFilters, syncRun: ListedSyncRun | null): SQL[] {
  if (syncRun) {
    const inserted = db.select({
      id: transactions.id
    }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.account_id)).where(syncRunTransactions(syncRun.started_at));

    return [sql`t.id IN (${inserted})`];
  }

  return [sql`t.currency=${filters.currency}`, periodCondition(filters.period)];
}

/**
 * One page of the transaction list for the selected filters, with the number of matches across all pages.
 * The caller resolves `filters.syncRunId`; a requested run that it could not find yields an empty page.
 */
export async function readTransactionPage<Run extends ListedSyncRun>(filters: DashboardFilters, syncRun: Run | null) {
  if (filters.syncRunId && !syncRun) {
    return {
      period: periodToJson(filters.period),
      page: filters.page,
      syncRun: null,
      transactionCount: 0,
      transactions: []
    };
  }

  const db = await database();
  const where = listScope(db, filters, syncRun);

  if (filters.search) {
    where.push(searchCondition(filters.search));
  }

  if (filters.accountId) {
    where.push(sql`a.id=${filters.accountId}`);
  }

  if (filters.categoryId === "uncategorized") {
    where.push(uncategorizedCondition);
  } else if (filters.categoryId) {
    where.push(sql`(t.category_id=${filters.categoryId} OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND s.category_id=${filters.categoryId}))`);
  }

  if (filters.type) {
    where.push(sql`t.type=${filters.type}`);
  }

  const condition = sql.join(where, sql.raw(" AND "));
  const transactionsQuery = selectTransactions(db, condition, transactionPageSize, (filters.page - 1) * transactionPageSize);
  const countQuery = db.all<Record<string, unknown>>(sql`
    SELECT COUNT(*) AS n
    FROM transactions t
    JOIN accounts a ON a.id=t.account_id
    WHERE ${condition}
  `);
  const [transactions, count] = await Promise.all([transactionsQuery, countQuery]);

  return {
    period: periodToJson(filters.period),
    page: filters.page,
    syncRun,
    transactionCount: Number(count[0].n),
    transactions: await toTransactions(transactions)
  };
}

// Banks report dates without a time, so bookings within a day are ordered by payee and description; empty payees come last.
function selectTransactions(db: Awaited<ReturnType<typeof database>>, condition: SQL, limit: number, offset: number) {
  return db.all<Record<string, unknown>>(sql`
    SELECT t.id,t.date,t.amount_minor,t.currency,t.instructed_amount_minor,t.instructed_currency,COALESCE(t.counterparty_override,t.counterparty) AS counterparty,COALESCE(t.description_override,t.description) AS description,t.counterparty AS source_counterparty,t.description AS source_description,t.counterparty_override,t.description_override,t.suppressed_at IS NOT NULL AS hidden,a.name AS account_name,t.account_id,t.category_id,t.category_source,t.category_rule_id,t.type,t.type_source,t.type_rule_id,a.provider='manual' AS manual_account,a.archived_at IS NOT NULL AS account_archived,COALESCE(pa.archived_at IS NOT NULL,0) AS counterpart_archived,t.provider_reference LIKE ${`${createdCounterpartPrefix}%`} AS created_counterpart,${enteredColumn("t", "a")} AS entered,${enteredColumn("p", "pa")} AS counterpart_entered,p.id AS counterpart_id,pa.name AS counterpart_account_name,p.date AS counterpart_booking_date,st.id AS trade_id,st.side AS trade_side,st.date AS trade_date,st.quantity_micros AS trade_quantity_micros,st.price_micros AS trade_price_micros,st.gross_minor AS trade_gross_minor,st.fee_minor AS trade_fee_minor,st.tax_minor AS trade_tax_minor,sec.name AS trade_security_name,sec.isin AS trade_security_isin,ba.id AS trade_account_id,ba.name AS trade_account_name,ba.archived_at IS NOT NULL AS trade_account_archived
    FROM transactions t
    JOIN accounts a ON a.id=t.account_id
    LEFT JOIN transactions p ON p.transfer_id=t.transfer_id AND p.id<>t.id
    LEFT JOIN accounts pa ON pa.id=p.account_id
    LEFT JOIN security_trades st ON st.settlement_transaction_id=t.id
    LEFT JOIN securities sec ON sec.id=st.security_id
    LEFT JOIN accounts ba ON ba.id=st.account_id
    WHERE ${condition}
    ORDER BY t.date DESC,COALESCE(t.counterparty_override,t.counterparty)='',COALESCE(t.counterparty_override,t.counterparty) COLLATE NOCASE,COALESCE(t.description_override,t.description) COLLATE NOCASE,t.id
    LIMIT ${limit}
    OFFSET ${offset}
  `);
}

async function toTransactions(rows: Record<string, unknown>[]): Promise<Transaction[]> {
  const hasManualRows = rows.some(row => row.category_source === "manual");
  const rules = hasManualRows ? prepareRules(await listRules()) : null;
  const splits = await readSplitParts(rows.map(row => String(row.id)));


  return rows.map(row => ({
    id: String(row.id),
    date: String(row.date),
    amount_minor: Number(row.amount_minor),
    currency: String(row.currency),
    instructed_amount_minor: row.instructed_amount_minor === null ? null : Number(row.instructed_amount_minor),
    instructed_currency: row.instructed_currency === null ? null : String(row.instructed_currency),
    counterparty: String(row.counterparty),
    description: String(row.description),
    source_counterparty: String(row.source_counterparty),
    source_description: String(row.source_description),
    hidden: Boolean(row.hidden),
    account_name: String(row.account_name),
    account_id: String(row.account_id),
    category_id: row.category_id === null ? null : String(row.category_id),
    category_source: String(row.category_source),
    category_rule_id: row.category_rule_id === null ? null : String(row.category_rule_id),
    automatic_assignment: splits.has(String(row.id)) ? null : automaticAssignment(row, rules),
    split: splitOf(splits.get(String(row.id)), Number(row.amount_minor)),
    type: row.type as TransactionType,
    type_source: row.type_source === "manual" ? "manual" as const : "auto" as const,
    type_rule_id: row.type_rule_id === null ? null : String(row.type_rule_id),
    manual_account: Boolean(row.manual_account),
    account_archived: Boolean(row.account_archived),
    counterpart_archived: Boolean(row.counterpart_archived),
    created_counterpart: Boolean(row.created_counterpart),
    ...entryState(row),
    counterpart: row.counterpart_id === null ? null : {
      id: String(row.counterpart_id),
      account_name: String(row.counterpart_account_name),
      date: String(row.counterpart_booking_date),
      entered: Boolean(row.counterpart_entered)
    },
    trade: row.trade_id === null ? null : {
      id: String(row.trade_id),
      side: row.trade_side === "sell" ? "sell" as const : "buy" as const,
      date: String(row.trade_date),
      quantity_micros: Number(row.trade_quantity_micros),
      price_micros: Number(row.trade_price_micros),
      gross_minor: Number(row.trade_gross_minor),
      fee_minor: Number(row.trade_fee_minor),
      tax_minor: Number(row.trade_tax_minor),
      security_name: String(row.trade_security_name),
      security_isin: row.trade_security_isin === null ? null : String(row.trade_security_isin),
      account_id: String(row.trade_account_id),
      account_name: String(row.trade_account_name),
      account_archived: Boolean(row.trade_account_archived)
    }
  }));
}

/** One booking as the transaction list shows it, for opening it from elsewhere, such as a brokerage trade; undefined when it does not exist. */
export async function readTransaction(id: string) {
  const db = await database();
  const [transaction] = await toTransactions(await selectTransactions(db, sql`t.id=${id}`, 1, 0));

  return transaction;
}
