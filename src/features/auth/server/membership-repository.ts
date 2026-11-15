import { and, eq } from "drizzle-orm";
import { database, type DatabaseTransaction } from "@/server/database/connection";
import { memberships } from "./auth-schema";

export const installationWorkspaceId = "personal";

export async function activeMembership(userId: string) {
  const db = await database();

  return db.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, installationWorkspaceId), eq(memberships.active, true))).get();
}

export async function ownerExists(db: DatabaseTransaction) {
  return db.select().from(memberships).where(and(eq(memberships.role, "owner"), eq(memberships.active, true))).get();
}

export async function addMembership(db: DatabaseTransaction, userId: string, role: "owner" | "member") {
  await db.insert(memberships).values({
    userId,
    workspaceId: installationWorkspaceId,
    role
  });
}
