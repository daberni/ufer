-- Each transaction gets an explicit type that replaces the category flag is_transfer. Existing results stay unchanged: transactions in a category flagged as a transfer become transfers, all others income (positive amount) or expense.
-- SQLite cannot add a NOT NULL column without a default, so the table is rebuilt with the same columns, constraints and indexes plus the new columns. No other table references transactions.
CREATE TABLE `transactions_new` (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  provider_reference TEXT NOT NULL,
  booking_date TEXT NOT NULL,
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
  type TEXT NOT NULL CHECK(type IN ('income','expense','transfer','opening_balance','adjustment')),
  type_source TEXT NOT NULL DEFAULT 'auto' CHECK(type_source IN ('auto','manual')),
  -- Shared by the two linked bookings of one transfer between own accounts; NULL for every other transaction.
  transfer_id TEXT,
  -- 'manual' once a person linked or unlinked the booking; automatic pairing then leaves it alone.
  transfer_source TEXT NOT NULL DEFAULT 'auto' CHECK(transfer_source IN ('auto','manual')),
  UNIQUE(account_id,provider_reference),
  CHECK(transfer_id IS NULL OR type='transfer')
);
--> statement-breakpoint
-- A manually assigned transfer category was a deliberate correction, so the resulting type counts as manual too.
INSERT INTO `transactions_new`(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_id,category_source,created_at,instructed_amount_minor,instructed_currency,provider_payload,type,type_source)
SELECT t.id,t.account_id,t.provider_reference,t.booking_date,t.amount_minor,t.currency,t.counterparty,t.description,t.category_id,t.category_source,t.created_at,t.instructed_amount_minor,t.instructed_currency,t.provider_payload,
  CASE WHEN c.is_transfer=1 THEN 'transfer' WHEN t.amount_minor>0 THEN 'income' ELSE 'expense' END,
  CASE WHEN c.is_transfer=1 AND t.category_source='manual' THEN 'manual' ELSE 'auto' END
FROM transactions t
LEFT JOIN categories c ON c.id=t.category_id
ORDER BY t.rowid;
--> statement-breakpoint
DROP TABLE transactions;
--> statement-breakpoint
ALTER TABLE `transactions_new` RENAME TO `transactions`;
--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`booking_date` DESC);
--> statement-breakpoint
CREATE INDEX `transactions_account` ON `transactions` (`account_id`,`booking_date`);
--> statement-breakpoint
CREATE INDEX `transactions_created_at` ON `transactions` (`created_at`);
--> statement-breakpoint
-- At most one outgoing and one incoming booking per transfer.
CREATE UNIQUE INDEX `transactions_transfer_side` ON `transactions` (`transfer_id`,`amount_minor` > 0) WHERE `transfer_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE categories DROP COLUMN is_transfer;
