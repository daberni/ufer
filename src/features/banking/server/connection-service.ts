import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError } from "@/lib/errors";
import { database } from "@/server/database/connection";
import { acquireLease, releaseLease } from "@/server/jobs/lease-repository";
import { decrypt } from "@/server/security/secret-box";
import { removeConnection, type ConnectionRemoval } from "./connection-repository";
import { BankingError, deleteSession } from "./enable-banking-client";
import { environment } from "./environment";
import { syncLeaseName } from "./sync-service";

export type ProviderRevocation = "revoked" | "not_revoked" | "no_session";

// A callback that consumed its state shortly before may still be exchanging the code and must not be removed underneath it.
const authorizationExchangeWindow = Temporal.Duration.from({
  minutes: 5
});

export async function removeBankConnection(id: string) {
  const db = await database();
  const env = environment();
  const owner = randomUUID();
  const leaseName = syncLeaseName(env);

  if (!(await acquireLease(db, leaseName, owner))) {
    throw new HttpError(409, "A sync is running. Remove the connection after it has finished.");
  }

  let removal: ConnectionRemoval;

  try {
    const exchangeCutoff = Temporal.Now.instant().subtract(authorizationExchangeWindow);

    removal = await removeConnection(db, env, id, exchangeCutoff);
  } finally {
    await releaseLease(db, leaseName, owner);
  }

  if (removal.outcome === "missing") {
    throw new HttpError(404, "Bank connection not found or already removed.");
  }

  if (removal.outcome === "authorizing") {
    throw new HttpError(409, "This bank connection is still being authorized. Try again in a few minutes.");
  }

  const providerRevocation = await revokeProviderSession(removal.sessionCipher);

  return {
    retainedAccounts: removal.retainedAccounts,
    providerRevocation
  };
}

// The local removal is already committed; a failed upstream revocation only leaves the consent to expire at the provider.
async function revokeProviderSession(sessionCipher: string | null): Promise<ProviderRevocation> {
  if (!sessionCipher) {
    return "no_session";
  }

  try {
    await deleteSession(decrypt(sessionCipher));

    return "revoked";
  } catch (error) {
    console.warn("Enable Banking session revocation failed after local connection removal.", {
      reason: revocationFailureReason(error)
    });

    return "not_revoked";
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
