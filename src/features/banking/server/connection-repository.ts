import { and, eq, gt, isNull } from "drizzle-orm";
import { database, type Database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import type { AuthContext } from "@/features/auth/server/session";
import { requisitions } from "@/server/database/schema";

export type AuthorizationRecord = {
  id: string;
  bank: string;
  country: string;
  stateHash: string;
  browserHash: string;
  authorizationId: string;
  actor: AuthContext;
};

export async function insertAuthorization(record: AuthorizationRecord) {
  const db = await database();

  await db.insert(requisitions).values({
    id: record.id,
    environment: environment(),
    workspace_id: record.actor.workspaceId,
    initiated_by_user_id: record.actor.userId,
    auth_session_id: record.actor.sessionId,
    bank_name: record.bank,
    bank_country: record.country,
    state_hash: record.stateHash,
    browser_hash: record.browserHash,
    state_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    authorization_id: record.authorizationId
  });
}

export async function consumeAuthorization(db: Database, environment: string, stateHash: string, browserHash: string, actor: AuthContext) {
  const now = new Date().toISOString();
  const scope = and(eq(requisitions.workspace_id, actor.workspaceId), eq(requisitions.initiated_by_user_id, actor.userId), eq(requisitions.auth_session_id, actor.sessionId), eq(requisitions.environment, environment), eq(requisitions.state_hash, stateHash), eq(requisitions.browser_hash, browserHash), isNull(requisitions.used_at), gt(requisitions.state_expires_at, now), eq(requisitions.status, "PENDING"));

  return db.update(requisitions).set({
    used_at: now,
    status: "EXCHANGING"
  }).where(scope).returning().get();
}

export async function saveBankSession(db: Database, id: string, ciphertext: string, validUntil: string) {
  await db.update(requisitions).set({
    session_cipher: ciphertext,
    valid_until: validUntil,
    status: "LINKED",
    error: null
  }).where(eq(requisitions.id, id));
}

export async function expireConnection(db: Database, id: string) {
  await db.update(requisitions).set({
    status: "EXPIRED"
  }).where(eq(requisitions.id, id));
}

export async function recordEmptyConnection(db: Database, id: string) {
  await db.update(requisitions).set({
    error: "No accounts were authorized. Restricted production applications require accounts to be linked in the provider control panel first."
  }).where(eq(requisitions.id, id));
}

export async function recordConnectionFailure(db: Database, id: string, error: string) {
  await db.update(requisitions).set({
    status: "ERROR",
    error
  }).where(eq(requisitions.id, id));
}
