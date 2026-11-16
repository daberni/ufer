-- Sync-run history counts the rows a run inserted by their creation timestamp.
CREATE INDEX `transactions_created_at` ON `transactions` (`created_at`);
