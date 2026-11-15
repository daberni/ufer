import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", {
    mode: "boolean"
  }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", {
    mode: "timestamp_ms"
  }).notNull(),
  updatedAt: integer("updated_at", {
    mode: "timestamp_ms"
  }).notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username")
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey().notNull(),
  expiresAt: integer("expires_at", {
    mode: "timestamp_ms"
  }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", {
    mode: "timestamp_ms"
  }).notNull(),
  updatedAt: integer("updated_at", {
    mode: "timestamp_ms"
  }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUsers.id, {
    onDelete: "cascade"
  })
}, table => [index("auth_sessions_user").on(table.userId)]);

export const authAccounts = sqliteTable("auth_accounts", {
  id: text("id").primaryKey().notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, {
    onDelete: "cascade"
  }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp_ms"
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp_ms"
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", {
    mode: "timestamp_ms"
  }).notNull(),
  updatedAt: integer("updated_at", {
    mode: "timestamp_ms"
  }).notNull()
}, table => [index("auth_accounts_user").on(table.userId)]);

export const authVerifications = sqliteTable("auth_verifications", {
  id: text("id").primaryKey().notNull(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", {
    mode: "timestamp_ms"
  }).notNull(),
  createdAt: integer("created_at", {
    mode: "timestamp_ms"
  }).notNull(),
  updatedAt: integer("updated_at", {
    mode: "timestamp_ms"
  }).notNull()
}, table => [index("auth_verifications_identifier").on(table.identifier)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  id: text("id").primaryKey().notNull(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull()
});

// Financial queries currently serve one installation. A second customer must not be provisioned into this schema.
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull()
}, table => [check("workspaces_single_installation", sql`${table.id} = 'personal'`)]);

export const memberships = sqliteTable("memberships", {
  userId: text("user_id").notNull().references(() => authUsers.id, {
    onDelete: "cascade"
  }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  role: text("role", {
    enum: ["owner", "member"]
  }).notNull(),
  active: integer("active", {
    mode: "boolean"
  }).notNull().default(true)
}, table => [
  primaryKey({
    columns: [table.userId, table.workspaceId]
  }),
  check("memberships_role", sql`${table.role} IN ('owner','member')`)
]);
