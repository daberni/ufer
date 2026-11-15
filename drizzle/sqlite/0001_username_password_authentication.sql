CREATE TABLE auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  username TEXT UNIQUE,
  display_username TEXT
);
--> statement-breakpoint
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
--> statement-breakpoint
CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_accounts_user ON auth_accounts(user_id);
--> statement-breakpoint
CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_verifications_identifier ON auth_verifications(identifier);
--> statement-breakpoint
CREATE TABLE auth_rate_limits (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL CHECK(id = 'personal'),
  name TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO workspaces(id,name) VALUES('personal','My finances');
--> statement-breakpoint
CREATE TABLE memberships (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id,workspace_id)
);
--> statement-breakpoint
ALTER TABLE requisitions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
--> statement-breakpoint
UPDATE requisitions SET workspace_id='personal';
--> statement-breakpoint
ALTER TABLE requisitions ADD COLUMN initiated_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE requisitions ADD COLUMN auth_session_id TEXT REFERENCES auth_sessions(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE requisitions SET status='ERROR',used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error='Sign-in has changed. Start a new bank authorization.' WHERE status IN ('PENDING','EXCHANGING');
--> statement-breakpoint
DROP TABLE login_attempts;
