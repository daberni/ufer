-- Brokerage accounts hold securities whose value comes from trades and daily prices instead of transactions (ADR 012). Every existing row and value is kept.
-- The account kind and transaction type constraints can only widen by rebuilding accounts and transactions. The migrator runs with foreign keys off, and both rebuilt tables keep their names, column order and IDs, so references from transactions, balance snapshots, identifiers and splits stay valid and no split is cascaded away.
CREATE TABLE `accounts_new` (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('checking','savings','investment','brokerage','loan','property','credit_card')),
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
INSERT INTO `accounts_new`(id,name,kind,currency,provider,provider_uid,requisition_id,iban,balance_minor,balance_date,last_synced_at,sync_error,provider_name,archived_at)
SELECT id,name,kind,currency,provider,provider_uid,requisition_id,iban,balance_minor,balance_date,last_synced_at,sync_error,provider_name,archived_at
FROM accounts
ORDER BY rowid;
--> statement-breakpoint
DROP TABLE accounts;
--> statement-breakpoint
ALTER TABLE `accounts_new` RENAME TO `accounts`;
--> statement-breakpoint
-- Buy and sell are the cash legs of security trades on a settlement account; like transfers they count toward no income or spending.
CREATE TABLE `transactions_new` (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider_reference TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  counterparty TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id),
  category_source TEXT NOT NULL DEFAULT 'rule' CHECK(category_source IN ('rule','manual')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  instructed_amount_minor INTEGER,
  instructed_currency TEXT,
  provider_payload TEXT,
  type TEXT NOT NULL CHECK(type IN ('income','expense','transfer','opening_balance','adjustment','buy','sell')),
  type_source TEXT NOT NULL DEFAULT 'auto' CHECK(type_source IN ('auto','manual')),
  -- Shared by the two linked bookings of one transfer between own accounts; NULL for every other transaction.
  transfer_id TEXT,
  -- 'manual' once a person linked or unlinked the booking; automatic pairing then leaves it alone.
  transfer_source TEXT NOT NULL DEFAULT 'auto' CHECK(transfer_source IN ('auto','manual')),
  counterparty_override TEXT,
  description_override TEXT,
  suppressed_at TEXT,
  category_rule_id TEXT,
  type_rule_id TEXT,
  type_transfer_account_id TEXT,
  transfer_detected INTEGER NOT NULL DEFAULT 0 CHECK(transfer_detected IN (0,1)),
  booking_date TEXT,
  UNIQUE(account_id,provider_reference),
  CHECK(transfer_id IS NULL OR type='transfer')
);
--> statement-breakpoint
INSERT INTO `transactions_new`(id,account_id,provider_reference,date,amount_minor,currency,counterparty,description,category_id,category_source,created_at,instructed_amount_minor,instructed_currency,provider_payload,type,type_source,transfer_id,transfer_source,counterparty_override,description_override,suppressed_at,category_rule_id,type_rule_id,type_transfer_account_id,transfer_detected,booking_date)
SELECT id,account_id,provider_reference,date,amount_minor,currency,counterparty,description,category_id,category_source,created_at,instructed_amount_minor,instructed_currency,provider_payload,type,type_source,transfer_id,transfer_source,counterparty_override,description_override,suppressed_at,category_rule_id,type_rule_id,type_transfer_account_id,transfer_detected,booking_date
FROM transactions
ORDER BY rowid;
--> statement-breakpoint
DROP TABLE transactions;
--> statement-breakpoint
ALTER TABLE `transactions_new` RENAME TO `transactions`;
--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date` DESC);
--> statement-breakpoint
CREATE INDEX `transactions_account` ON `transactions` (`account_id`,`date`);
--> statement-breakpoint
CREATE INDEX `transactions_created_at` ON `transactions` (`created_at`);
--> statement-breakpoint
-- At most one outgoing and one incoming booking per transfer.
CREATE UNIQUE INDEX `transactions_transfer_side` ON `transactions` (`transfer_id`,`amount_minor` > 0) WHERE `transfer_id` IS NOT NULL;
--> statement-breakpoint
-- A security is shared by every account that holds it. A provider symbol (for example VWCE.XETRA) names the listing whose daily closes value it; a security without a provider has no automatic prices.
CREATE TABLE `securities` (
  id TEXT PRIMARY KEY NOT NULL,
  isin TEXT,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT,
  provider_symbol TEXT,
  venue TEXT,
  -- The last price update attempt and its error, shown so a failed or missing price is visible.
  price_checked_at TEXT,
  price_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT securities_provider CHECK ((provider IS NULL) = (provider_symbol IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_provider_symbol` ON `securities` (`provider`,`provider_symbol`) WHERE `provider` IS NOT NULL;
--> statement-breakpoint
-- Daily closing prices in micro-units (millionths) of the security's currency; provider data, never transactions.
CREATE TABLE `security_prices` (
  security_id TEXT NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  close_micros INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(security_id,date),
  CONSTRAINT security_prices_close CHECK (close_micros > 0)
);
--> statement-breakpoint
-- A split multiplies every quantity held before its date by numerator/denominator; prices stay the real closing prices.
CREATE TABLE `security_splits` (
  security_id TEXT NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  numerator INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  PRIMARY KEY(security_id,date),
  CONSTRAINT security_splits_ratio CHECK (numerator > 0 AND denominator > 0)
);
--> statement-breakpoint
-- Buys and sells are the only source of positions on a brokerage account. Quantities and prices are micro-units, money minor units of the security's currency; gross is the traded amount before fees and taxes.
-- The settlement transaction is the cash leg on the settlement account; it is a plain ID, maintained together with the trade.
CREATE TABLE `security_trades` (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  security_id TEXT NOT NULL REFERENCES securities(id),
  date TEXT NOT NULL,
  side TEXT NOT NULL,
  -- Replay order within the account: moving-average cost depends on whether a same-day sale comes before or after a buy.
  sequence INTEGER NOT NULL,
  quantity_micros INTEGER NOT NULL,
  price_micros INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  settlement_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT security_trades_side CHECK (side IN ('buy','sell')),
  CONSTRAINT security_trades_amounts CHECK (quantity_micros > 0 AND price_micros > 0 AND gross_minor >= 0 AND fee_minor >= 0 AND tax_minor >= 0)
);
--> statement-breakpoint
CREATE INDEX `security_trades_account` ON `security_trades` (`account_id`,`date`);
--> statement-breakpoint
CREATE INDEX `security_trades_security` ON `security_trades` (`security_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_trades_sequence` ON `security_trades` (`account_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_trades_settlement` ON `security_trades` (`settlement_transaction_id`) WHERE `settlement_transaction_id` IS NOT NULL;
