-- A rule may also set the type of the bookings it decides; for a transfer, optionally the own account on the other side. Existing rules set no type.
-- No foreign key to accounts: removing demo accounts must not fail on a rule that names one; the application treats an unknown account as no counterpart account.
ALTER TABLE categorization_rules ADD COLUMN transaction_type TEXT CHECK (transaction_type IN ('income','expense','transfer'));
--> statement-breakpoint
ALTER TABLE categorization_rules ADD COLUMN transfer_account_id TEXT CHECK (transfer_account_id IS NULL OR transaction_type IS 'transfer');
--> statement-breakpoint
-- The rule that set an automatic type. Existing types stay unattributed; like category_rule_id it is not a foreign key.
ALTER TABLE transactions ADD COLUMN type_rule_id TEXT;
--> statement-breakpoint
-- Whether the bank or file reported the booking as a transfer, so a released rule type returns to Transfer instead of the amount's sign.
ALTER TABLE transactions ADD COLUMN transfer_detected INTEGER NOT NULL DEFAULT 0 CHECK (transfer_detected IN (0,1));
--> statement-breakpoint
-- Unlinked automatic transfers were detected; linked ones may be paired income or expense, which keeps the previous behavior when they are unlinked.
UPDATE transactions SET transfer_detected=1 WHERE type='transfer' AND type_source='auto' AND transfer_id IS NULL;
