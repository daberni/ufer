import type { Database } from "@/server/database/connection";
import { decrypt } from "@/server/security/secret-box";
import { clearRevokedSession, listUnrevokedSessions } from "./connection-repository";
import { BankingError, deleteSession, sessionEnded } from "./enable-banking-client";

export type ProviderRevocation = "revoked" | "not_revoked" | "no_session";

type StoredSession = {
  id: string;
  session_cipher: string;
};

/** Revokes a released connection's provider session and deletes the stored ID only once the provider no longer holds it. */
export async function revokeStoredSession(db: Database, session: StoredSession): Promise<ProviderRevocation> {
  try {
    await deleteSession(decrypt(session.session_cipher));
  } catch (error) {
    if (!sessionEnded(error)) {
      console.warn("Enable Banking session revocation failed; the session stays stored for a later retry.", {
        reason: revocationFailureReason(error)
      });

      return "not_revoked";
    }
  }

  await clearRevokedSession(db, session.id, session.session_cipher);

  return "revoked";
}

/** Retries every stored session of removed, superseded or failed connections; failures stay stored and are logged. */
export async function revokeReleasedSessions(db: Database, environment: string) {
  const sessions = await listUnrevokedSessions(db, environment);

  for (const session of sessions) {
    if (session.session_cipher) {
      await revokeStoredSession(db, {
        id: session.id,
        session_cipher: session.session_cipher
      });
    }
  }
}

// Provider error codes and exception types are safe to log; messages may contain provider or configuration details.
function revocationFailureReason(error: unknown) {
  if (error instanceof BankingError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}
