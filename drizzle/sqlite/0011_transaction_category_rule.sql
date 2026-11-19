-- The rule that assigned a rule-sourced category. Existing assignments stay unattributed. Deleting a rule clears its references in the application; no foreign key, so a sync that read a rule deleted meanwhile still saves.
ALTER TABLE transactions ADD COLUMN category_rule_id TEXT;
