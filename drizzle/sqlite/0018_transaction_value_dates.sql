-- Bank bookings count on their value date; the column they count on is renamed to date, and the bank's own booking date gets its own column.
-- Existing rows keep their date. The next sync redelivers the bookings in its window with both dates; older bookings keep the bank booking date in date and a null booking_date.
ALTER TABLE transactions RENAME COLUMN booking_date TO date;
--> statement-breakpoint
ALTER TABLE transactions ADD booking_date text;
