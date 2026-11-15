-- Stores a stable application icon key, never SVG markup. Existing categories keep NULL (no icon).
ALTER TABLE categories ADD COLUMN icon TEXT;
