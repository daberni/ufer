import type { AuthContext } from "@/features/auth/server/session";
import { HttpError } from "@/lib/errors";
import { encrypt } from "@/server/security/secret-box";
import { hash } from "@/server/security/tokens";
import { database } from "@/server/database/connection";
import { cancelPendingAuthorization, consumeAuthorization, recordConnectionFailure, recordEmptyConnection, saveBankSession } from "./connection-repository";
import { saveSessionAccounts } from "./bank-account-repository";
import { createSession } from "./enable-banking-client";
import { environment } from "./environment";
import { revokeReleasedSessions } from "./session-revocation";

export async function completeAuthorization(state: string, browserSecret: string, code: string, actor: AuthContext) {
  const db = await database();
  const env = environment();
  const connection = await consumeAuthorization(db, env, hash(state), hash(browserSecret), actor);

  if (!connection) {
    throw new HttpError(400, "The bank callback has expired, has already been used, or belongs to another browser.");
  }

  try {
    const session = await createSession(code);

    if (session.aspsp.name !== connection.bank_name || session.aspsp.country !== connection.bank_country) {
      throw new HttpError(502, "The bank callback does not match the requested connection.");
    }

    // Persist the once-only provider response before mapping accounts, so a mapping failure still leaves the session to revoke.
    const sessionSaved = await saveBankSession(db, connection.id, encrypt(session.session_id), session.access.valid_until);

    if (!sessionSaved) {
      throw new HttpError(409, "The bank connection was removed during authorization.");
    }

    await saveSessionAccounts(db, env, connection.id, connection.bank_name, session.accounts);

    if (!session.accounts.length) {
      await recordEmptyConnection(db, connection.id);
    }

    return {
      accounts: session.accounts.length
    };
  } catch (error) {
    await recordConnectionFailure(db, connection.id, error instanceof HttpError ? error.message : "Bank connection failed.");

    throw error;
  } finally {
    // Sessions this authorization superseded or could not use are revoked; a failed revocation is logged and retried by later syncs.
    await revokeReleasedSessions(db, env);
  }
}

/** Consumes the state of an authorization the user cancelled at the bank, so its callback cannot be used afterwards. */
export async function cancelAuthorization(state: string, browserSecret: string, actor: AuthContext) {
  const db = await database();

  await cancelPendingAuthorization(db, environment(), hash(state), hash(browserSecret), actor);
}
