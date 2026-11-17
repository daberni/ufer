-- Transaction types already preserve whether a booking is a transfer. Retire only the seeded category, not custom categories.
DELETE FROM categorization_rules WHERE category_id = 'transfer';
--> statement-breakpoint
UPDATE transactions SET category_id = NULL WHERE category_id = 'transfer';
--> statement-breakpoint
DELETE FROM categories WHERE id = 'transfer';
