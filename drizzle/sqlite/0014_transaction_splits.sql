-- Parts of a split booking, each with its own amount and category. The booking keeps its amount for balances; reports count the parts instead. Deleting the booking deletes its parts; deleting a category leaves its parts uncategorized.
CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  CONSTRAINT transaction_splits_amount CHECK (amount_minor <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX transaction_splits_position ON transaction_splits(transaction_id,position);
--> statement-breakpoint
CREATE INDEX transaction_splits_category ON transaction_splits(category_id);
