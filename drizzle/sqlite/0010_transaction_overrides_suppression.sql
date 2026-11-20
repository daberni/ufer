ALTER TABLE transactions ADD COLUMN counterparty_override TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN description_override TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN suppressed_at TEXT;
