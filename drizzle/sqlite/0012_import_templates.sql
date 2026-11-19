CREATE TABLE import_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  header_key TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_templates_header_key ON import_templates(header_key);
--> statement-breakpoint
CREATE UNIQUE INDEX import_templates_name ON import_templates(lower(name));
