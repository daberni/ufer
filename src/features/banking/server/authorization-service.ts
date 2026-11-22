import type { AuthContext } from "@/server/security/session";
import { HttpError } from "@/lib/errors";
import { encrypt } from "@/server/security/secret-box";
import { hash } from "@/server/security/tokens";
import { cancelPendingAuthorization, clearRevokedSession, consumeAuthorization, recordConnectionFailure, recordEmptyConnection, recordRevocationFailure, saveBankSession } from "./connection-repository";
import { saveSessionAccounts } from "./bank-account-repository";
import { createSession, validateBankSession } from "./enable-banking-client";
import { revokeSession } from "./session-revocation";

export async function completeAuthorization(state: string, browserSecret: string, code: string, actor: AuthContext) {
  const connection = await consumeAuthorization(hash(state), hash(browserSecret), actor);

  if (!connection) {
    throw new HttpError(400, "The bank callback has expired, has already been used, or belongs to another browser.");
  }

  let storedSession: {
    id: string;
    session_cipher: string
  } | null = null;
  let releasedSessions: {
    id: string;
    session_cipher: string | null
  }[] = [];

  try {
    const envelope = await createSession(code);

    // Retain the once-only credential before validating details, so a malformed response still leaves the session to revoke.
    const sessionCipher = encrypt(envelope.session_id);
    const sessionSaved = await saveBankSession(connection.id, sessionCipher, null);

    if (!sessionSaved) {
      throw new HttpError(409, "The bank connection was removed during authorization.");
    }

    storedSession = {
      id: connection.id,
      session_cipher: sessionCipher
    };
    const session = validateBankSession(envelope);

    if (session.aspsp.name !== connection.bank_name || session.aspsp.country !== connection.bank_country) {
      throw new HttpError(502, "The bank callback does not match the requested connection.");
    }

    releasedSessions = await saveSessionAccounts(connection.id, connection.bank_name, session.access.valid_until, session.accounts);

    if (!session.accounts.length) {
      await recordEmptyConnection(connection.id);
    }

    return {
      accounts: session.accounts.length
    };
  } catch (error) {
    if (storedSession) {
      releasedSessions.push(storedSession);
    }

    await recordConnectionFailure(connection.id, error instanceof HttpError ? error.message : "Bank connection failed.");

    throw error;
  } finally {
    // Only this callback's newly released sessions get one attempt; a failure stays visible for an explicit removal retry.
    for (const session of releasedSessions) {
      if (!session.session_cipher) {
        continue;
      }

      if (await revokeSession(session.session_cipher)) {
        await clearRevokedSession(session.id, session.session_cipher);
      } else {
        await recordRevocationFailure(session.id);
      }
    }
  }
}

/** Consumes the state of an authorization the user cancelled at the bank, so its callback cannot be used afterwards. */
export async function cancelAuthorization(state: string, browserSecret: string, actor: AuthContext) {
  await cancelPendingAuthorization(hash(state), hash(browserSecret), actor);
}
