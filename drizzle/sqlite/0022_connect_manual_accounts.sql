-- A bank authorization started from a manual account records that account; its callback connects it to the authorized bank account instead of creating a new one. Deleting the account clears the reference, so authorizations never block deletion.
ALTER TABLE requisitions ADD COLUMN target_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Removing a connection now leaves manual accounts: bank accounts already detached by a removal become manual accounts. Their bank identifiers stay, so a new authorization of the same bank account connects them again.
UPDATE accounts SET provider='manual', provider_uid=NULL WHERE provider<>'manual' AND requisition_id IS NULL;
