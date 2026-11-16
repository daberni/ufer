-- Optional provider data per bank transaction. Every column is nullable; existing rows, CSV imports and manual entries keep NULL.
-- Original amount in minor units of instructed_currency, signed like amount_minor.
ALTER TABLE transactions ADD COLUMN instructed_amount_minor INTEGER;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN instructed_currency TEXT;
--> statement-breakpoint
-- The provider's transaction object as JSON text; later features derive further columns from it.
ALTER TABLE transactions ADD COLUMN provider_payload TEXT;
