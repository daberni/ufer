import { and, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { database, type Database } from "@/server/database/connection";
import { environment } from "@/features/banking/server/environment";
import type { AuthContext } from "@/features/auth/server/session";
import { accounts, requisitions } from "@/server/database/schema";
import { timestamp } from "@/lib/time";

export type ConnectionRemoval = {
  outcome: "missing";
} | {
  outcome: "authorizing";
} | {
  outcome: "removed";
  sessionCipher: string | null;
  retainedAccounts: number;
};

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
    state_expires_at: timestamp(Temporal.Now.instant().add({
      minutes: 15
    })),
    authorization_id: record.authorizationId
  });
}

// Connections that no longer read bank data; a stored session stays until the provider confirms its revocation.
const releasedStatuses = ["REMOVED", "SUPERSEDED", "ERROR"];

function pendingAuthorization(environment: string, stateHash: string, browserHash: string, actor: AuthContext, now: string) {
  return and(eq(requisitions.workspace_id, actor.workspaceId), eq(requisitions.initiated_by_user_id, actor.userId), eq(requisitions.auth_session_id, actor.sessionId), eq(requisitions.environment, environment), eq(requisitions.state_hash, stateHash), eq(requisitions.browser_hash, browserHash), isNull(requisitions.used_at), gt(requisitions.state_expires_at, now), eq(requisitions.status, "PENDING"));
}

export async function consumeAuthorization(db: Database, environment: string, stateHash: string, browserHash: string, actor: AuthContext) {
  const now = timestamp();

  return db.update(requisitions).set({
    used_at: now,
    status: "EXCHANGING"
  }).where(pendingAuthorization(environment, stateHash, browserHash, actor, now)).returning().get();
}

export async function cancelPendingAuthorization(db: Database, environment: string, stateHash: string, browserHash: string, actor: AuthContext) {
  const now = timestamp();

  await db.update(requisitions).set({
    used_at: now,
    status: "ERROR",
    error: "The bank authorization was cancelled."
  }).where(pendingAuthorization(environment, stateHash, browserHash, actor, now));
}

export async function listUnrevokedSessions(db: Database, environment: string) {
  return db.select({
    id: requisitions.id,
    session_cipher: requisitions.session_cipher
  }).from(requisitions).where(and(eq(requisitions.environment, environment), inArray(requisitions.status, releasedStatuses), isNotNull(requisitions.session_cipher)));
}

export async function clearRevokedSession(db: Database, id: string, sessionCipher: string) {
  await db.update(requisitions).set({
    session_cipher: null
  }).where(and(eq(requisitions.id, id), eq(requisitions.session_cipher, sessionCipher)));
}

// The connection stays EXCHANGING until its accounts are mapped, so removal cannot interleave between the two steps.
export async function saveBankSession(db: Database, id: string, ciphertext: string, validUntil: string) {
  const saved = await db.update(requisitions).set({
    session_cipher: ciphertext,
    valid_until: validUntil,
    error: null
  }).where(and(eq(requisitions.id, id), eq(requisitions.status, "EXCHANGING"))).returning({
    id: requisitions.id
  });

  return saved.length === 1;
}

export async function expireConnection(db: Database, id: string) {
  await db.update(requisitions).set({
    status: "EXPIRED"
  }).where(eq(requisitions.id, id));
}

export async function recordEmptyConnection(db: Database, id: string) {
  await db.update(requisitions).set({
    error: "No accounts were authorized. Link the accounts in the provider control panel first, then reconnect."
  }).where(and(eq(requisitions.id, id), ne(requisitions.status, "REMOVED")));
}

export async function recordConnectionFailure(db: Database, id: string, error: string) {
  await db.update(requisitions).set({
    status: "ERROR",
    error
  }).where(and(eq(requisitions.id, id), ne(requisitions.status, "REMOVED")));
}

// Accounts are detached rather than deleted, so their history stays and a later reconnect can remap them by identification hash.
// The session ID stays stored until the provider confirms its revocation, so a failed revocation can be retried.
export async function removeConnection(db: Database, environment: string, id: string, exchangeCutoff: Temporal.Instant): Promise<ConnectionRemoval> {
  return db.transaction(async tx => {
    const scope = and(eq(requisitions.id, id), eq(requisitions.environment, environment), ne(requisitions.status, "REMOVED"));
    const connection = await tx.select({
      status: requisitions.status,
      used_at: requisitions.used_at,
      session_cipher: requisitions.session_cipher
    }).from(requisitions).where(scope).get();

    if (!connection) {
      return {
        outcome: "missing"
      };
    }

    const exchanging = connection.status === "EXCHANGING" && connection.used_at !== null && Temporal.Instant.compare(Temporal.Instant.from(connection.used_at), exchangeCutoff) > 0;

    if (exchanging) {
      return {
        outcome: "authorizing"
      };
    }

    const detached = await tx.update(accounts).set({
      requisition_id: null,
      sync_error: null
    }).where(and(eq(accounts.requisition_id, id), eq(accounts.environment, environment))).returning({
      id: accounts.id
    });

    await tx.update(requisitions).set({
      status: "REMOVED",
      valid_until: null,
      error: null
    }).where(scope);

    return {
      outcome: "removed",
      sessionCipher: connection.session_cipher,
      retainedAccounts: detached.length
    };
  });
}
