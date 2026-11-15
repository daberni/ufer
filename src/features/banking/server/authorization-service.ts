import { HttpError } from "@/lib/errors";
import { encrypt } from "@/server/security/secret-box";
import { hash } from "@/server/security/tokens";
import { database } from "@/server/database/connection";
import { consumeAuthorization, recordConnectionFailure, recordEmptyConnection, saveBankSession } from "./connection-repository";
import { saveSessionAccounts } from "./bank-account-repository";
import { bankingRequest, type BankSession } from "./enable-banking-client";
import { environment } from "./environment";

export async function completeAuthorization(state: string, browserSecret: string, code: string) {
  const db = await database();
  const env = environment();
  const connection = await consumeAuthorization(db, env, hash(state), hash(browserSecret));

  if (!connection) {
    throw new HttpError(400, "The bank callback has expired, has already been used, or belongs to another browser.");
  }

  try {
    const session = await bankingRequest<BankSession>("/sessions", {
      code
    });

    if (session.aspsp.name !== connection.bank_name || session.aspsp.country !== connection.bank_country || !session.session_id || !session.access?.valid_until) {
      throw new HttpError(502, "The bank callback does not match the requested connection.");
    }

    // Persist the once-only provider response before mapping accounts, so mapping failures do not lose consent credentials.
    await saveBankSession(db, connection.id, encrypt(session.session_id), session.access.valid_until);
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
  }
}
