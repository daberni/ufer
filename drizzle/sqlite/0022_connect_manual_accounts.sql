-- A bank authorization started from a manual account records that account; its callback connects it to the authorized bank account instead of creating a new one. It is a plain ID, not a foreign key: the account stays deletable, and a callback whose account is gone fails instead of connecting every authorized account.
ALTER TABLE requisitions ADD COLUMN target_account_id TEXT;
--> statement-breakpoint
-- Removing a connection now leaves manual accounts: bank accounts already detached by a removal become manual accounts. Their bank identifiers stay, so a new authorization of the same bank account connects them again.
UPDATE accounts SET provider='manual', provider_uid=NULL WHERE provider<>'manual' AND requisition_id IS NULL;
