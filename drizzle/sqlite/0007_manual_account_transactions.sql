-- Manual accounts derive their balance from their transactions. Their balance history becomes transactions without changing any balance: the first snapshot becomes the opening balance and each later snapshot an adjustment, so the balance at the end of every snapshot date equals that snapshot.
-- Transactions already on the account between two snapshots were included in the later snapshot, so each step books only the remaining difference; a later step without a difference is not booked.
-- Rows get a temporary reference here and their final 'manual:<id>' reference below, because the id is random.
INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_id,category_source,type,type_source)
SELECT id,account_id,'migration-0006:' || snapshot_id,observed_at,amount_minor,currency,'','',NULL,'manual',type,'manual'
FROM (
  SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',1+(abs(random())%4),1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) AS id,
    s.account_id,
    s.id AS snapshot_id,
    s.observed_at,
    a.currency,
    CASE WHEN s.previous_at IS NULL THEN 'opening_balance' ELSE 'adjustment' END AS type,
    s.amount_minor-s.previous_amount-COALESCE((
      SELECT SUM(t.amount_minor)
      FROM transactions t
      WHERE t.account_id=s.account_id
      AND t.booking_date<=s.observed_at
      AND (s.previous_at IS NULL OR t.booking_date>s.previous_at)
    ),0) AS amount_minor
  FROM (
    SELECT id,account_id,observed_at,amount_minor,
      LAG(observed_at) OVER history AS previous_at,
      LAG(amount_minor,1,0) OVER history AS previous_amount
    FROM balance_snapshots
    WINDOW history AS (PARTITION BY account_id ORDER BY observed_at)
  ) s
  JOIN accounts a ON a.id=s.account_id
  WHERE a.provider='manual'
)
WHERE type='opening_balance' OR amount_minor<>0;
--> statement-breakpoint
-- The stored current balance stays authoritative: where transactions after the newest snapshot, or a missing history, make the sum differ from it, one more row books the difference on the newest date. An account without any transaction gets its balance as the opening balance.
INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_id,category_source,type,type_source)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',1+(abs(random())%4),1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
  id,
  'migration-0006:current',
  CASE
    WHEN newest_booking IS NULL THEN COALESCE(balance_date,date('now'))
    WHEN balance_date IS NULL OR newest_booking>balance_date THEN newest_booking
    ELSE balance_date
  END,
  balance_minor-booked,
  currency,'','',NULL,'manual',
  CASE WHEN newest_booking IS NULL THEN 'opening_balance' ELSE 'adjustment' END,
  'manual'
FROM (
  SELECT a.id,a.currency,a.balance_minor,a.balance_date,
    (SELECT MAX(t.booking_date) FROM transactions t WHERE t.account_id=a.id) AS newest_booking,
    COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.account_id=a.id),0) AS booked
  FROM accounts a
  WHERE a.provider='manual'
  AND a.balance_minor IS NOT NULL
)
WHERE newest_booking IS NULL OR balance_minor<>booked;
--> statement-breakpoint
UPDATE transactions SET provider_reference='manual:' || id WHERE provider_reference LIKE 'migration-0006:%';
--> statement-breakpoint
-- Snapshots of synced accounts stay; manual accounts no longer keep a separate balance history or a stored balance.
DELETE FROM balance_snapshots WHERE account_id IN (SELECT id FROM accounts WHERE provider='manual');
--> statement-breakpoint
UPDATE accounts SET balance_minor=NULL,balance_date=NULL WHERE provider='manual';
