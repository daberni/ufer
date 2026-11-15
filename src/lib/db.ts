import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const schema = [
  `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, is_transfer INTEGER NOT NULL DEFAULT 0 CHECK(is_transfer IN (0,1)))`,
  `CREATE TABLE IF NOT EXISTS requisitions (id TEXT PRIMARY KEY, environment TEXT NOT NULL, bank_name TEXT NOT NULL, bank_country TEXT NOT NULL, state_hash TEXT UNIQUE, browser_hash TEXT, state_expires_at TEXT, used_at TEXT, authorization_id TEXT, session_cipher TEXT, valid_until TEXT, status TEXT NOT NULL DEFAULT 'PENDING', error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, environment TEXT NOT NULL, name TEXT NOT NULL, institution TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('checking','savings','investment','loan','property','credit_card')), currency TEXT NOT NULL DEFAULT 'EUR', provider TEXT NOT NULL DEFAULT 'manual', provider_uid TEXT, requisition_id TEXT REFERENCES requisitions(id), iban TEXT, balance_minor INTEGER, balance_date TEXT, last_synced_at TEXT, sync_error TEXT, UNIQUE(environment,provider_uid))`,
  `CREATE TABLE IF NOT EXISTS account_identifiers (environment TEXT NOT NULL, identification_hash TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), PRIMARY KEY(environment,identification_hash))`,
  `CREATE TABLE IF NOT EXISTS categorization_rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, pattern TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('keyword','regex')), category_id TEXT NOT NULL REFERENCES categories(id), priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))`,
  `CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), provider_reference TEXT NOT NULL, booking_date TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, counterparty TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', category_id TEXT REFERENCES categories(id), category_source TEXT NOT NULL DEFAULT 'rule' CHECK(category_source IN ('rule','manual')), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(account_id,provider_reference))`,
  `CREATE INDEX IF NOT EXISTS transactions_date ON transactions(booking_date DESC)`,
  `CREATE INDEX IF NOT EXISTS transactions_account ON transactions(account_id,booking_date)`,
  `CREATE TABLE IF NOT EXISTS balance_snapshots (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), observed_at TEXT NOT NULL, amount_minor INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('sync','manual','csv')), UNIQUE(account_id,observed_at))`,
  `CREATE TABLE IF NOT EXISTS sync_runs (id TEXT PRIMARY KEY, environment TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, inserted_count INTEGER NOT NULL DEFAULT 0, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (fingerprint TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
];

export async function initialize(client: Client) {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.batch(schema, "write");
  const categories = [
    ["groceries", "Groceries", "#488a75", 0],
    ["home", "Housing", "#8e82b3", 0],
    ["transport", "Transport", "#c59c50", 0],
    ["leisure", "Leisure", "#cb8577", 0],
    ["income", "Income", "#3a816c", 0],
    ["transfer", "Transfer", "#8c9692", 1],
    ["fees", "Fees & taxes", "#9f8380", 0],
  ];
  await client.batch(categories.map(([id, name, color, transfer]) => ({ sql: "INSERT OR IGNORE INTO categories(id,name,color,is_transfer) VALUES(?,?,?,?)", args: [id, name, color, transfer] })), "write");
  return client;
}

const globalDb = globalThis as unknown as { budgetDb?: Promise<Client> };

export function db(): Promise<Client> {
  if (!globalDb.budgetDb) {
    const url = process.env.DATABASE_URL || "file:data/budget.db";
    if (process.env.VERCEL && url.startsWith("file:")) throw new Error("Vercel requires a persistent external libSQL database.");
    if (url.startsWith("file:")) mkdirSync(dirname(url.slice(5)), { recursive: true });
    const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN, intMode: "number" });
    globalDb.budgetDb = initialize(client).catch(error => { globalDb.budgetDb = undefined; client.close(); throw error; });
  }
  return globalDb.budgetDb;
}

export function environment() {
  const value = process.env.ENABLE_BANKING_ENVIRONMENT || "SANDBOX";
  if (value !== "SANDBOX" && value !== "PRODUCTION") throw new Error("Invalid banking environment.");
  return value;
}
