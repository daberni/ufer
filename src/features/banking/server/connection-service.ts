import { Temporal } from "temporal-polyfill";
import { HttpError } from "@/lib/errors";
import { timestamp } from "@/lib/time";
import { syncLease, withLease } from "@/server/jobs/lease";
import { prepareConnectionRemoval, removeConnection } from "./connection-repository";
import { revokeSession } from "./session-revocation";

// A callback that consumed its state shortly before may still be exchanging the code and must not be removed underneath it.
const authorizationExchangeWindow = Temporal.Duration.from({
  minutes: 5
});

/** Revokes the provider session and keeps the connection's accounts with their history, optionally archiving them. */
export async function removeBankConnection(id: string, options: {
  archiveAccounts: boolean
} = {
  archiveAccounts: false
}) {
  return withLease(syncLease, "A sync is running. Remove the connection after it has finished.", async () => {
    const exchangeCutoff = Temporal.Now.instant().subtract(authorizationExchangeWindow);
    const prepared = await prepareConnectionRemoval(id, exchangeCutoff);

    if (prepared.outcome === "missing") {
      throw new HttpError(404, "Bank connection not found or already removed.");
    }

    if (prepared.outcome === "authorizing") {
      throw new HttpError(409, "This bank connection is still being authorized. Try again in a few minutes.");
    }

    if (prepared.sessionCipher && !(await revokeSession(prepared.sessionCipher))) {
      throw new HttpError(502, "The bank authorization could not be revoked. The connection has not been removed. Try again.");
    }

    const archivedAt = options.archiveAccounts ? timestamp() : null;
    const removal = await removeConnection(id, exchangeCutoff, prepared.sessionCipher, archivedAt);

    if (removal.outcome === "missing") {
      throw new HttpError(404, "Bank connection not found or already removed.");
    }

    if (removal.outcome === "authorizing") {
      throw new HttpError(409, "This bank connection is still being authorized. Try again in a few minutes.");
    }

    return {
      retainedAccounts: removal.retainedAccounts,
      notArchived: removal.notArchived
    };
  });
}
