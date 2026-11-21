-- Accounts no longer store an institution: a bank-linked account names its bank through its connection's bank_name and a manual account has none. Manual institutions, including the 'CSV import' text CSV imports stored, are dropped.
-- Bank accounts keep their connection after it is removed, so the bank name stays available. Accounts already detached by an earlier removal are linked to the most recent removed connection of the bank they name.
UPDATE accounts SET requisition_id=(
  SELECT r.id FROM requisitions r WHERE r.status='REMOVED' AND r.bank_name=accounts.institution ORDER BY r.created_at DESC LIMIT 1
)
WHERE provider='enable_banking' AND requisition_id IS NULL;
--> statement-breakpoint
-- A detached account without such a connection gets one removed placeholder connection per bank name, which no connection list shows. The error column marks the placeholders until they are linked.
INSERT INTO requisitions(id,bank_name,bank_country,status,error)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',1+(abs(random())%4),1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  institution,'','REMOVED','migration-0018:placeholder'
FROM (SELECT DISTINCT institution FROM accounts WHERE provider='enable_banking' AND requisition_id IS NULL);
--> statement-breakpoint
UPDATE accounts SET requisition_id=(
  SELECT r.id FROM requisitions r WHERE r.error='migration-0018:placeholder' AND r.bank_name=accounts.institution
)
WHERE provider='enable_banking' AND requisition_id IS NULL;
--> statement-breakpoint
UPDATE requisitions SET error=NULL WHERE error='migration-0018:placeholder';
--> statement-breakpoint
ALTER TABLE accounts DROP COLUMN institution;
