-- Each database serves exactly one banking environment, so the per-row environment columns are dropped and provider identities are unique on their own. Every row and value is kept.
-- The unique constraint and primary key that include environment can only change by rebuilding accounts and account_identifiers; the migrator runs with foreign keys off, and the rebuilt accounts table keeps its name and IDs, so references from transactions, balance snapshots and identifiers stay valid.
-- A database holding the same provider account or identifier in both environments violates the new constraints and the whole changeset rolls back.
-- Dropping the column erases the only discriminator between environments, so a database holding rows from more than one environment is refused and the changeset rolls back.
CREATE TEMP TABLE `environment_guard` (environments INTEGER NOT NULL CHECK(environments <= 1));
--> statement-breakpoint
INSERT INTO `environment_guard`(environments)
SELECT COUNT(DISTINCT environment) FROM (
  SELECT environment FROM requisitions
  UNION SELECT environment FROM accounts
  UNION SELECT environment FROM account_identifiers
  UNION SELECT environment FROM sync_runs
);
--> statement-breakpoint
DROP TABLE `environment_guard`;
--> statement-breakpoint
CREATE TABLE `accounts_new` (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('checking','savings','investment','loan','property','credit_card')),
  currency TEXT NOT NULL DEFAULT 'EUR',
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_uid TEXT UNIQUE,
  requisition_id TEXT REFERENCES requisitions(id),
  iban TEXT,
  balance_minor INTEGER,
  balance_date TEXT,
  last_synced_at TEXT,
  sync_error TEXT,
  provider_name TEXT,
  archived_at TEXT
);
--> statement-breakpoint
INSERT INTO `accounts_new`(id,name,institution,kind,currency,provider,provider_uid,requisition_id,iban,balance_minor,balance_date,last_synced_at,sync_error,provider_name,archived_at)
SELECT id,name,institution,kind,currency,provider,provider_uid,requisition_id,iban,balance_minor,balance_date,last_synced_at,sync_error,provider_name,archived_at
FROM accounts
ORDER BY rowid;
--> statement-breakpoint
DROP TABLE accounts;
--> statement-breakpoint
ALTER TABLE `accounts_new` RENAME TO `accounts`;
--> statement-breakpoint
CREATE TABLE `account_identifiers_new` (
  identification_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id)
);
--> statement-breakpoint
INSERT INTO `account_identifiers_new`(identification_hash,account_id)
SELECT identification_hash,account_id
FROM account_identifiers
ORDER BY rowid;
--> statement-breakpoint
DROP TABLE account_identifiers;
--> statement-breakpoint
ALTER TABLE `account_identifiers_new` RENAME TO `account_identifiers`;
--> statement-breakpoint
ALTER TABLE requisitions DROP COLUMN environment;
--> statement-breakpoint
ALTER TABLE sync_runs DROP COLUMN environment;
