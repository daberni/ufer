import { desc, sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  is_transfer: integer("is_transfer").notNull().default(0)
}, table => [check("categories_is_transfer", sql`${table.is_transfer} IN (0,1)`)]);

export const requisitions = sqliteTable("requisitions", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
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
  created_at: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
}, table => [
  unique("transactions_account_id_provider_reference_unique").on(table.account_id, table.provider_reference),
  index("transactions_date").on(desc(table.booking_date)),
  index("transactions_account").on(table.account_id, table.booking_date),
  check("transactions_category_source", sql`${table.category_source} IN ('rule','manual')`)
]);

export const balanceSnapshots = sqliteTable("balance_snapshots", {
  id: text("id").primaryKey(),
  account_id: text("account_id").notNull().references(() => accounts.id),
  observed_at: text("observed_at").notNull(),
  amount_minor: integer("amount_minor").notNull(),
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

export const loginAttempts = sqliteTable("login_attempts", {
  fingerprint: text("fingerprint").primaryKey(),
  attempts: integer("attempts").notNull(),
  expires_at: integer("expires_at").notNull()
});
