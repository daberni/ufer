-- A rule may match only the bookings of one account; existing rules keep matching every account.
-- No foreign key to accounts, like transfer_account_id: removing an account must not fail on a rule that names it, and a rule naming an unknown account matches nothing.
ALTER TABLE categorization_rules ADD COLUMN account_id TEXT;
