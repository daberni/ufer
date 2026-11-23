-- Security transfers move a quantity of one security between two brokerage accounts without a sale (#362). A new table only; no existing row changes.
-- Each leg takes a replay position in its account's sequence alongside that account's trades. The carried cost basis is not stored: it is derived by replaying the sending account, so a correction of an earlier trade carries through.
CREATE TABLE `security_transfers` (
  id TEXT PRIMARY KEY NOT NULL,
  security_id TEXT NOT NULL REFERENCES securities(id),
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  from_sequence INTEGER NOT NULL,
  to_sequence INTEGER NOT NULL,
  quantity_micros INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT security_transfers_accounts CHECK (from_account_id <> to_account_id),
  CONSTRAINT security_transfers_quantity CHECK (quantity_micros > 0)
);
--> statement-breakpoint
CREATE INDEX `security_transfers_security` ON `security_transfers` (`security_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_transfers_from_sequence` ON `security_transfers` (`from_account_id`,`from_sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_transfers_to_sequence` ON `security_transfers` (`to_account_id`,`to_sequence`);
