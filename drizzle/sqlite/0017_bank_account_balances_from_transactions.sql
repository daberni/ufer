-- Bank-linked accounts derive their balance from their transactions like manual accounts. One opening balance per account books the difference between the stored provider balance and its visible bookings, dated the day before its oldest booking, snapshot or balance date, so the current balance stays identical.
-- Historical differences between reported balances and bookings are deliberately not booked; the reported balances stay in balance_snapshots for comparison.
-- Rows get a temporary reference here and their final 'manual:<id>' reference below, because the id is random.
INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_id,category_source,type,type_source)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',1+(abs(random())%4),1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  a.id,
  'migration-0017:opening',
  date(MIN(
    COALESCE(a.balance_date,date('now')),
    COALESCE((SELECT MIN(t.booking_date) FROM transactions t WHERE t.account_id=a.id),COALESCE(a.balance_date,date('now'))),
    COALESCE((SELECT MIN(s.observed_at) FROM balance_snapshots s WHERE s.account_id=a.id),COALESCE(a.balance_date,date('now')))
  ),'-1 day'),
  a.balance_minor-COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=a.id AND t.suppressed_at IS NULL),0),
  a.currency,'','',NULL,'manual','opening_balance','manual'
FROM accounts a
WHERE a.provider<>'manual'
AND a.balance_minor IS NOT NULL;
--> statement-breakpoint
UPDATE transactions SET provider_reference='manual:' || id WHERE provider_reference='migration-0017:opening';
--> statement-breakpoint
-- The reported balance lives on only in balance_snapshots; a stored balance never synced into a snapshot is kept there as well.
INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,bank_balance_type,source)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',1+(abs(random())%4),1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  a.id,a.balance_date,a.balance_minor,NULL,'sync'
FROM accounts a
WHERE a.provider<>'manual'
AND a.balance_minor IS NOT NULL
AND a.balance_date IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM balance_snapshots s WHERE s.account_id=a.id AND s.observed_at=a.balance_date);
--> statement-breakpoint
UPDATE accounts SET balance_minor=NULL,balance_date=NULL WHERE provider<>'manual';
