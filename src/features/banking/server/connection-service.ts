import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError } from "@/lib/errors";
import { database } from "@/server/database/connection";
import { acquireLease, releaseLease } from "@/server/jobs/lease-repository";
import { prepareConnectionRemoval, removeConnection } from "./connection-repository";
import { environment } from "./environment";
import { revokeSession } from "./session-revocation";
import { syncLeaseName } from "./sync-service";

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

  try {
    const exchangeCutoff = Temporal.Now.instant().subtract(authorizationExchangeWindow);
    const prepared = await prepareConnectionRemoval(db, env, id, exchangeCutoff);

    if (prepared.outcome === "missing") {
      throw new HttpError(404, "Bank connection not found or already removed.");
    }

    if (prepared.outcome === "authorizing") {
      throw new HttpError(409, "This bank connection is still being authorized. Try again in a few minutes.");
    }

    if (prepared.sessionCipher && !(await revokeSession(prepared.sessionCipher))) {
      throw new HttpError(502, "The bank authorization could not be revoked. The connection has not been removed. Try again.");
    }

    const removal = await removeConnection(db, env, id, exchangeCutoff);

    if (removal.outcome === "missing") {
      throw new HttpError(404, "Bank connection not found or already removed.");
    }

    if (removal.outcome === "authorizing") {
      throw new HttpError(409, "This bank connection is still being authorized. Try again in a few minutes.");
    }

    return {
      retainedAccounts: removal.retainedAccounts
    };
  } finally {
    await releaseLease(db, leaseName, owner);
  }
}
