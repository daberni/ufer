-- Bank bookings count on their value date, for a card payment the purchase date; the bank's later booking date moves to its own column for balance reconciliation and duplicate matching.
-- The column the bookings count on is renamed to date, since for bank bookings it no longer holds the booking date.
-- Amounts are untouched, so every account's current balance stays identical. Rows without a stored provider payload keep their date.
ALTER TABLE transactions RENAME COLUMN booking_date TO date;
--> statement-breakpoint
ALTER TABLE transactions ADD bank_booking_date text;
--> statement-breakpoint
UPDATE transactions SET
  bank_booking_date=CASE WHEN json_extract(provider_payload,'$.booking_date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(json_extract(provider_payload,'$.booking_date'))=json_extract(provider_payload,'$.booking_date') THEN json_extract(provider_payload,'$.booking_date') END,
  date=CASE WHEN json_extract(provider_payload,'$.value_date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(json_extract(provider_payload,'$.value_date'))=json_extract(provider_payload,'$.value_date') THEN json_extract(provider_payload,'$.value_date') ELSE date END
WHERE provider_reference LIKE 'bank:%'
AND provider_payload IS NOT NULL
AND json_valid(provider_payload);
--> statement-breakpoint
-- A booking entered in Ufer on a manual account follows the date of the bank booking it is linked with, as a sync would mirror it.
UPDATE transactions SET date=(
  SELECT b.date FROM transactions b
  WHERE b.transfer_id=transactions.transfer_id AND b.id<>transactions.id AND b.provider_reference LIKE 'bank:%'
)
WHERE transfer_id IS NOT NULL
AND (provider_reference LIKE 'manual:%' OR provider_reference LIKE 'transfer:%')
AND account_id IN (SELECT id FROM accounts WHERE provider='manual')
AND EXISTS (
  SELECT 1 FROM transactions b
  WHERE b.transfer_id=transactions.transfer_id AND b.id<>transactions.id AND b.provider_reference LIKE 'bank:%'
  AND b.bank_booking_date=transactions.date AND b.date<>b.bank_booking_date
);
--> statement-breakpoint
-- A bank-linked account's opening balance stays in front of bookings whose value date moved before it; it already contained them, so its amount stays.
UPDATE transactions SET date=(
  SELECT date(MIN(t.date),'-1 day') FROM transactions t
  WHERE t.account_id=transactions.account_id AND t.id<>transactions.id
)
WHERE type='opening_balance'
AND account_id IN (SELECT id FROM accounts WHERE provider<>'manual')
AND EXISTS (
  SELECT 1 FROM transactions t
  WHERE t.account_id=transactions.account_id AND t.id<>transactions.id
  AND t.date<=transactions.date AND t.bank_booking_date IS NOT NULL AND t.date<>t.bank_booking_date
);
