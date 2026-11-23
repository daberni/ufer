import { desc, sql } from "drizzle-orm";
import { authSessions, authUsers, workspaces } from "./auth-schema";
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { ruleTransactionTypes, transactionTypes } from "@/lib/transaction-types";
import { storedAccountKinds } from "@/features/accounts/account-kinds";
import { tradeSides } from "@/features/securities/trade-sides";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  icon: text("icon")
});

export const requisitions = sqliteTable("requisitions", {
  id: text("id").primaryKey(),
  workspace_id: text("workspace_id").references(() => workspaces.id),
  initiated_by_user_id: text("initiated_by_user_id").references(() => authUsers.id, {
    onDelete: "set null"
  }),
  auth_session_id: text("auth_session_id").references(() => authSessions.id, {
    onDelete: "set null"
  }),
  bank_name: text("bank_name").notNull(),
  bank_country: text("bank_country").notNull(),
  state_hash: text("state_hash").unique(),
  browser_hash: text("browser_hash"),
  state_expires_at: text("state_expires_at"),
  used_at: text("used_at"),
  authorization_id: text("authorization_id"),
  session_cipher: text("session_cipher"),
  valid_until: text("valid_until"),
  status: text("status").notNull().default("PENDING"),
  error: text("error"),
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  // The manual account an authorization started from; its callback connects that account instead of creating one.
  // Deliberately no foreign key: the account stays deletable, and a callback whose target is gone fails instead of becoming untargeted.
  target_account_id: text("target_account_id")
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider_name: text("provider_name"),
  kind: text("kind", {
    enum: storedAccountKinds
  }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  provider: text("provider").notNull().default("manual"),
  provider_uid: text("provider_uid").unique(),
  requisition_id: text("requisition_id").references(() => requisitions.id),
  iban: text("iban"),
  // Unused since changeset 0017: every balance is the sum of its transactions and reported bank balances live in balance_snapshots. Always NULL.
  balance_minor: integer("balance_minor"),
  balance_date: text("balance_date"),
  last_synced_at: text("last_synced_at"),
  sync_error: text("sync_error"),
  // Set while the account is archived: hidden from the account lists and pickers, but its history and report contributions remain.
  archived_at: text("archived_at")
}, table => [
  check("accounts_kind", sql`${table.kind} IN ('checking','savings','investment','brokerage','loan','property','credit_card')`)
]);

export const accountIdentifiers = sqliteTable("account_identifiers", {
  identification_hash: text("identification_hash").primaryKey(),
  account_id: text("account_id").notNull().references(() => accounts.id)
});

export const categorizationRules = sqliteTable("categorization_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pattern: text("pattern").notNull(),
  mode: text("mode", {
    enum: ["keyword", "regex"]
  }).notNull(),
  category_id: text("category_id").notNull().references(() => categories.id),
  priority: integer("priority").notNull().default(100),
  enabled: integer("enabled").notNull().default(1),
  // The type the rule sets on the bookings it decides; null leaves the automatic type.
  transaction_type: text("transaction_type", {
    enum: ruleTransactionTypes
  }),
  // For a transfer, the own account on the other side. Not a foreign key: removing an account must not fail on a rule, and an unknown account means no counterpart account.
  transfer_account_id: text("transfer_account_id"),
  // Limits the rule to the bookings of this account; null matches every account. Not a foreign key, like transfer_account_id; an unknown account matches nothing.
  account_id: text("account_id")
}, table => [
  check("categorization_rules_mode", sql`${table.mode} IN ('keyword','regex')`),
  check("categorization_rules_enabled", sql`${table.enabled} IN (0,1)`),
  check("categorization_rules_transaction_type", sql`${table.transaction_type} IN ('income','expense','transfer')`),
  check("categorization_rules_transfer_account", sql`${table.transfer_account_id} IS NULL OR ${table.transaction_type} IS 'transfer'`)
]);

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  account_id: text("account_id").notNull().references(() => accounts.id),
  provider_reference: text("provider_reference").notNull(),
  // The date the booking counts on everywhere; for a bank booking its value date.
  date: text("date").notNull(),
  // The bank's own booking date of a synced booking, which may be a few days after its value date; null for other sources. Balance reconciliation and duplicate matching use it.
  booking_date: text("booking_date"),
  amount_minor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  counterparty: text("counterparty").notNull().default(""),
  description: text("description").notNull().default(""),
  category_id: text("category_id").references(() => categories.id),
  category_source: text("category_source", {
    enum: ["rule", "manual"]
  }).notNull().default("rule"),
  // The rule that assigned a rule-sourced category; null for manual or uncategorized bookings and assignments before it was recorded. Deleting a rule clears it.
  // Not a foreign key: a sync or import that read a rule deleted meanwhile must still save, and readers treat an unknown rule as unrecorded.
  category_rule_id: text("category_rule_id"),
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  // Signed like amount_minor, in minor units of instructed_currency.
  instructed_amount_minor: integer("instructed_amount_minor"),
  instructed_currency: text("instructed_currency"),
  provider_payload: text("provider_payload"),
  type: text("type", {
    enum: transactionTypes
  }).notNull(),
  type_source: text("type_source", {
    enum: ["auto", "manual"]
  }).notNull().default("auto"),
  // The rule that set an automatic type; null for a derived or manual type and types set before it was recorded. Not a foreign key, like category_rule_id.
  type_rule_id: text("type_rule_id"),
  // The transfer account the rule named when it set the type; pairing uses it, so later rule edits apply only when rules are applied again. Not a foreign key.
  type_transfer_account_id: text("type_transfer_account_id"),
  // Whether the bank or file reported a transfer; a released rule type returns to Transfer. A delivery that re-derives the type replaces it.
  transfer_detected: integer("transfer_detected").notNull().default(0),
  // Shared by the two linked bookings of one transfer between own accounts.
  transfer_id: text("transfer_id"),
  // Manual once a person linked or unlinked the booking; automatic pairing then leaves it alone.
  transfer_source: text("transfer_source", {
    enum: ["auto", "manual"]
  }).notNull().default("auto"),
  // A person's payee and description for an imported booking; null shows the source's text, which every sync keeps refreshing.
  counterparty_override: text("counterparty_override"),
  description_override: text("description_override"),
  // Hidden imported booking: kept so a later sync or import finds and leaves it, excluded from balances, reports and pairing.
  suppressed_at: text("suppressed_at")
}, table => [
  unique("transactions_account_id_provider_reference_unique").on(table.account_id, table.provider_reference),
  index("transactions_date").on(desc(table.date)),
  index("transactions_account").on(table.account_id, table.date),
  index("transactions_created_at").on(table.created_at),
  uniqueIndex("transactions_transfer_side").on(table.transfer_id, sql`${table.amount_minor} > 0`).where(sql`${table.transfer_id} IS NOT NULL`),
  check("transactions_category_source", sql`${table.category_source} IN ('rule','manual')`),
  check("transactions_type", sql`${table.type} IN ('income','expense','transfer','opening_balance','adjustment','buy','sell')`),
  check("transactions_transfer_detected", sql`${table.transfer_detected} IN (0,1)`),
  check("transactions_type_source", sql`${table.type_source} IN ('auto','manual')`),
  check("transactions_transfer_source", sql`${table.transfer_source} IN ('auto','manual')`),
  check("transactions_transfer_type", sql`${table.transfer_id} IS NULL OR ${table.type}='transfer'`)
]);

// The parts of a split booking. The booking keeps its amount for balances; reports count its parts, which a person keeps summing to the booking's amount.
export const transactionSplits = sqliteTable("transaction_splits", {
  id: text("id").primaryKey(),
  transaction_id: text("transaction_id").notNull().references(() => transactions.id, {
    onDelete: "cascade"
  }),
  position: integer("position").notNull(),
  // Signed like the booking's amount_minor, in its currency.
  amount_minor: integer("amount_minor").notNull(),
  category_id: text("category_id").references(() => categories.id, {
    onDelete: "set null"
  }),
  note: text("note").notNull().default("")
}, table => [
  uniqueIndex("transaction_splits_position").on(table.transaction_id, table.position),
  index("transaction_splits_category").on(table.category_id),
  check("transaction_splits_amount", sql`${table.amount_minor} <> 0`)
]);

// Balances reported by the bank for synced accounts, compared with the calculated balance; balances themselves are transactions.
export const balanceSnapshots = sqliteTable("balance_snapshots", {
  id: text("id").primaryKey(),
  account_id: text("account_id").notNull().references(() => accounts.id),
  observed_at: text("observed_at").notNull(),
  amount_minor: integer("amount_minor").notNull(),
  bank_balance_type: text("bank_balance_type"),
  source: text("source", {
    enum: ["sync", "manual", "csv"]
  }).notNull()
}, table => [
  unique("balance_snapshots_account_id_observed_at_unique").on(table.account_id, table.observed_at),
  check("balance_snapshots_source", sql`${table.source} IN ('sync','manual','csv')`)
]);

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  status: text("status").notNull(),
  inserted_count: integer("inserted_count").notNull().default(0),
  error: text("error")
});

export const leases = sqliteTable("leases", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expires_at: text("expires_at").notNull()
});

/** Saved CSV mapping templates; `definition` holds the template as JSON, `header_key` the header row it recognizes and `name_key` the case-folded name (SQLite lower() folds ASCII only). */
export const importTemplates = sqliteTable("import_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  name_key: text("name_key").notNull(),
  header_key: text("header_key").notNull(),
  definition: text("definition").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull()
}, table => [
  uniqueIndex("import_templates_header_key").on(table.header_key),
  uniqueIndex("import_templates_name_key").on(table.name_key)
]);

export { authUsers, authSessions, authAccounts, authVerifications, authRateLimits, workspaces, memberships } from "./auth-schema";

/** A security shared by every account holding it; a provider symbol (for example `VWCE.XETRA`) names the listing whose daily closes value it. */
export const securities = sqliteTable("securities", {
  id: text("id").primaryKey(),
  isin: text("isin"),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  provider: text("provider"),
  provider_symbol: text("provider_symbol"),
  venue: text("venue"),
  // The last price update attempt and its error, so a failed or missing price is visible.
  price_checked_at: text("price_checked_at"),
  price_error: text("price_error"),
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
}, table => [
  uniqueIndex("securities_provider_symbol").on(table.provider, table.provider_symbol).where(sql`${table.provider} IS NOT NULL`),
  check("securities_provider", sql`(${table.provider} IS NULL) = (${table.provider_symbol} IS NULL)`)
]);

/** Daily closing prices in micro-units of the security's currency; provider data, never transactions. */
export const securityPrices = sqliteTable("security_prices", {
  security_id: text("security_id").notNull().references(() => securities.id, {
    onDelete: "cascade"
  }),
  date: text("date").notNull(),
  close_micros: integer("close_micros").notNull(),
  source: text("source").notNull(),
  fetched_at: text("fetched_at").notNull()
}, table => [
  primaryKey({
    columns: [table.security_id, table.date]
  }),
  check("security_prices_close", sql`${table.close_micros} > 0`)
]);

/** A split multiplies every quantity held before its date by numerator/denominator. */
export const securitySplits = sqliteTable("security_splits", {
  security_id: text("security_id").notNull().references(() => securities.id, {
    onDelete: "cascade"
  }),
  date: text("date").notNull(),
  numerator: integer("numerator").notNull(),
  denominator: integer("denominator").notNull()
}, table => [
  primaryKey({
    columns: [table.security_id, table.date]
  }),
  check("security_splits_ratio", sql`${table.numerator} > 0 AND ${table.denominator} > 0`)
]);

/** Buys and sells, the only source of positions on a brokerage account. Quantities and prices in micro-units, money in minor units of the security's currency. */
export const securityTrades = sqliteTable("security_trades", {
  id: text("id").primaryKey(),
  account_id: text("account_id").notNull().references(() => accounts.id),
  security_id: text("security_id").notNull().references(() => securities.id),
  date: text("date").notNull(),
  side: text("side", {
    enum: tradeSides
  }).notNull(),
  // Replay order within the account: moving-average cost depends on whether a same-day sale comes before or after a buy.
  sequence: integer("sequence").notNull(),
  quantity_micros: integer("quantity_micros").notNull(),
  price_micros: integer("price_micros").notNull(),
  // The traded amount before fees and taxes.
  gross_minor: integer("gross_minor").notNull(),
  // Kept apart from gross so a tax view can treat purchase costs differently from the cost basis, which includes them.
  fee_minor: integer("fee_minor").notNull().default(0),
  tax_minor: integer("tax_minor").notNull().default(0),
  // The cash leg on the settlement account; a plain ID maintained together with the trade.
  settlement_transaction_id: text("settlement_transaction_id"),
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
}, table => [
  index("security_trades_account").on(table.account_id, table.date),
  index("security_trades_security").on(table.security_id),
  uniqueIndex("security_trades_sequence").on(table.account_id, table.sequence),
  uniqueIndex("security_trades_settlement").on(table.settlement_transaction_id).where(sql`${table.settlement_transaction_id} IS NOT NULL`),
  check("security_trades_side", sql`${table.side} IN ('buy','sell')`),
  check("security_trades_amounts", sql`${table.quantity_micros} > 0 AND ${table.price_micros} > 0 AND ${table.gross_minor} >= 0 AND ${table.fee_minor} >= 0 AND ${table.tax_minor} >= 0`)
]);

/** A quantity of one security moved between two brokerage accounts without a sale; its cost basis is carried over by replaying the sending account. */
export const securityTransfers = sqliteTable("security_transfers", {
  id: text("id").primaryKey(),
  security_id: text("security_id").notNull().references(() => securities.id),
  from_account_id: text("from_account_id").notNull().references(() => accounts.id),
  to_account_id: text("to_account_id").notNull().references(() => accounts.id),
  date: text("date").notNull(),
  // Each leg's replay position within its account, shared with that account's trades.
  from_sequence: integer("from_sequence").notNull(),
  to_sequence: integer("to_sequence").notNull(),
  quantity_micros: integer("quantity_micros").notNull(),
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
}, table => [
  index("security_transfers_security").on(table.security_id),
  uniqueIndex("security_transfers_from_sequence").on(table.from_account_id, table.from_sequence),
  uniqueIndex("security_transfers_to_sequence").on(table.to_account_id, table.to_sequence),
  check("security_transfers_accounts", sql`${table.from_account_id} <> ${table.to_account_id}`),
  check("security_transfers_quantity", sql`${table.quantity_micros} > 0`)
]);
