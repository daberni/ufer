import { desc, sql } from "drizzle-orm";
import { authSessions, authUsers, workspaces } from "@/features/auth/server/auth-schema";
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { transactionTypes } from "@/features/transactions/transaction-types";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  icon: text("icon")
});

export const requisitions = sqliteTable("requisitions", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
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
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  name: text("name").notNull(),
  institution: text("institution").notNull(),
  kind: text("kind", {
    enum: ["checking", "savings", "investment", "loan", "property", "credit_card"]
  }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  provider: text("provider").notNull().default("manual"),
  provider_uid: text("provider_uid"),
  requisition_id: text("requisition_id").references(() => requisitions.id),
  iban: text("iban"),
  // The provider balance of a synced account; a manual account's balance is the sum of its transactions and this stays NULL.
  balance_minor: integer("balance_minor"),
  balance_date: text("balance_date"),
  last_synced_at: text("last_synced_at"),
  sync_error: text("sync_error")
}, table => [
  unique("accounts_environment_provider_uid_unique").on(table.environment, table.provider_uid),
  check("accounts_kind", sql`${table.kind} IN ('checking','savings','investment','loan','property','credit_card')`)
]);

export const accountIdentifiers = sqliteTable("account_identifiers", {
  environment: text("environment").notNull(),
  identification_hash: text("identification_hash").notNull(),
  account_id: text("account_id").notNull().references(() => accounts.id)
}, table => [primaryKey({
  columns: [table.environment, table.identification_hash]
})]);

export const categorizationRules = sqliteTable("categorization_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pattern: text("pattern").notNull(),
  mode: text("mode", {
    enum: ["keyword", "regex"]
  }).notNull(),
  category_id: text("category_id").notNull().references(() => categories.id),
  priority: integer("priority").notNull().default(100),
  enabled: integer("enabled").notNull().default(1)
}, table => [
  check("categorization_rules_mode", sql`${table.mode} IN ('keyword','regex')`),
  check("categorization_rules_enabled", sql`${table.enabled} IN (0,1)`)
]);

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  account_id: text("account_id").notNull().references(() => accounts.id),
  provider_reference: text("provider_reference").notNull(),
  booking_date: text("booking_date").notNull(),
  amount_minor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  counterparty: text("counterparty").notNull().default(""),
  description: text("description").notNull().default(""),
  category_id: text("category_id").references(() => categories.id),
  category_source: text("category_source", {
    enum: ["rule", "manual"]
  }).notNull().default("rule"),
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
  // Shared by the two linked bookings of one transfer between own accounts.
  transfer_id: text("transfer_id"),
  // Manual once a person linked or unlinked the booking; automatic pairing then leaves it alone.
  transfer_source: text("transfer_source", {
    enum: ["auto", "manual"]
  }).notNull().default("auto")
}, table => [
  unique("transactions_account_id_provider_reference_unique").on(table.account_id, table.provider_reference),
  index("transactions_date").on(desc(table.booking_date)),
  index("transactions_account").on(table.account_id, table.booking_date),
  index("transactions_created_at").on(table.created_at),
  uniqueIndex("transactions_transfer_side").on(table.transfer_id, sql`${table.amount_minor} > 0`).where(sql`${table.transfer_id} IS NOT NULL`),
  check("transactions_category_source", sql`${table.category_source} IN ('rule','manual')`),
  check("transactions_type", sql`${table.type} IN ('income','expense','transfer','opening_balance','adjustment')`),
  check("transactions_type_source", sql`${table.type_source} IN ('auto','manual')`),
  check("transactions_transfer_source", sql`${table.transfer_source} IN ('auto','manual')`),
  check("transactions_transfer_type", sql`${table.transfer_id} IS NULL OR ${table.type}='transfer'`)
]);

// Provider balance history of synced accounts; manual accounts record balance changes as transactions.
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
  environment: text("environment").notNull(),
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

export { authUsers, authSessions, authAccounts, authVerifications, authRateLimits, workspaces, memberships } from "@/features/auth/server/auth-schema";
