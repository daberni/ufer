-- Keep any customized seed, deliberate assignment or non-demo rule as an ordinary category.
-- Only exact original demo-rule definitions count as programmatic references; edited demo rules are preserved too.
WITH retirable_category AS (
  SELECT seed.id
  FROM categories seed
  WHERE seed.id = 'transfer'
    AND seed.name = 'Transfer'
    AND seed.color = '#8c9692'
    AND seed.icon IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM transactions
      WHERE category_id = seed.id AND category_source = 'manual'
    )
    AND NOT EXISTS (
      SELECT 1 FROM categorization_rules
      WHERE category_id = seed.id
        AND (id,name,pattern,mode,priority,enabled) NOT IN (
          ('demo-rule-own-transfers','Transfers between own accounts','^(Everyday account|Emergency fund|Travel credit card|ETF portfolio|Rental flat, Linden Street|Mortgage, rental flat) ','regex',5,1),
          ('demo-rule-joint-account','Joint household account','Joint household account','keyword',6,1)
        )
    )
)
DELETE FROM categorization_rules WHERE category_id IN (SELECT id FROM retirable_category);
--> statement-breakpoint
WITH retirable_category AS (
  SELECT seed.id
  FROM categories seed
  WHERE seed.id = 'transfer'
    AND seed.name = 'Transfer'
    AND seed.color = '#8c9692'
    AND seed.icon IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM transactions
      WHERE category_id = seed.id AND category_source = 'manual'
    )
    AND NOT EXISTS (
      SELECT 1 FROM categorization_rules
      WHERE category_id = seed.id
        AND (id,name,pattern,mode,priority,enabled) NOT IN (
          ('demo-rule-own-transfers','Transfers between own accounts','^(Everyday account|Emergency fund|Travel credit card|ETF portfolio|Rental flat, Linden Street|Mortgage, rental flat) ','regex',5,1),
          ('demo-rule-joint-account','Joint household account','Joint household account','keyword',6,1)
        )
    )
)
UPDATE transactions SET category_id = NULL WHERE category_id IN (SELECT id FROM retirable_category);
--> statement-breakpoint
WITH retirable_category AS (
  SELECT seed.id
  FROM categories seed
  WHERE seed.id = 'transfer'
    AND seed.name = 'Transfer'
    AND seed.color = '#8c9692'
    AND seed.icon IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM transactions
      WHERE category_id = seed.id AND category_source = 'manual'
    )
    AND NOT EXISTS (
      SELECT 1 FROM categorization_rules
      WHERE category_id = seed.id
        AND (id,name,pattern,mode,priority,enabled) NOT IN (
          ('demo-rule-own-transfers','Transfers between own accounts','^(Everyday account|Emergency fund|Travel credit card|ETF portfolio|Rental flat, Linden Street|Mortgage, rental flat) ','regex',5,1),
          ('demo-rule-joint-account','Joint household account','Joint household account','keyword',6,1)
        )
    )
)
DELETE FROM categories WHERE id IN (SELECT id FROM retirable_category);
