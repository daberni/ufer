import type { Database } from "../../src/server/database/connection";
import type { AuthContext } from "../../src/features/auth/server/session";
import { authUsers, authSessions, memberships } from "../../src/features/auth/server/auth-schema";

export async function seedActor(db: Database): Promise<AuthContext> {
  const now = new Date();

  await db.insert(authUsers).values({
    id: "bank-user",
    name: "Example user",
    email: "bank-user@example.test",
    username: "bank-user",
    createdAt: now,
    updatedAt: now
  });
  await db.insert(authSessions).values({
    id: "bank-session",
    userId: "bank-user",
    token: "synthetic-bank-session",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date("2099-01-01")
  });
  await db.insert(memberships).values({
    userId: "bank-user",
    workspaceId: "personal",
    role: "owner"
  });

  return {
    userId: "bank-user",
    sessionId: "bank-session",
    workspaceId: "personal",
    role: "owner",
    name: "Example user",
    username: "bank-user",
    email: "bank-user@example.test"
  };
}
