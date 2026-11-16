-- Optional provider details per bank transaction. Every column is nullable; existing rows, CSV imports and manual entries keep NULL.
ALTER TABLE transactions ADD COLUMN value_date TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN transaction_date TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN bank_transaction_code TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN bank_transaction_sub_code TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN bank_transaction_description TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN merchant_category_code TEXT;
--> statement-breakpoint
-- Decimal text as delivered, so the rate keeps its full precision.
ALTER TABLE transactions ADD COLUMN exchange_rate TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN exchange_rate_unit_currency TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN exchange_rate_type TEXT;
--> statement-breakpoint
-- Original amount in minor units of instructed_currency, signed like amount_minor.
ALTER TABLE transactions ADD COLUMN instructed_amount_minor INTEGER;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN instructed_currency TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN balance_after_minor INTEGER;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN balance_after_currency TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN reference_number TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN counterparty_iban TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN counterparty_account_id TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN counterparty_account_scheme TEXT;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN counterparty_bic TEXT;
--> statement-breakpoint
-- The provider's transaction object as JSON text, kept so later features can re-derive data the bank no longer returns.
ALTER TABLE transactions ADD COLUMN provider_payload TEXT;
