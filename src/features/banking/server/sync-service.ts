import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError } from "@/lib/errors";
import { timestamp, today } from "@/lib/time";
import { renewLease } from "@/server/jobs/lease-repository";
import { syncLease, withLease } from "@/server/jobs/lease";
import { listRules } from "@/features/categorization/server/rule-repository";
import { fetchBalances, fetchTransactions, sessionEnded, verifyApplication } from "./enable-banking-client";
import { normalizeTransactions } from "./bank-data";
import { saveAccountSync } from "./account-sync-service";
import { finishSyncRun, interruptSyncRun, listSyncAccounts, recordAccountSyncError, startSyncRun } from "./sync-repository";
import { expireConnection, expireEndedSession } from "./connection-repository";
import { pairAllTransfers } from "@/features/transactions/server/transfer-repository";

// Only a new bank authorization resolves this failure; rate limits and provider data errors do not.
class ReconnectRequired extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

// The competing run owns the run row and the accounts from the moment the lease is lost.
class SyncLeaseLost extends HttpError {
  constructor() {
    super(409, "Sync lease lost; run sync again.");
  }
}

/** First booking date requested from the bank: 89 calendar days before today in the product zone. */
export function syncWindowStart(now = Temporal.Now.instant()) {
  return today(now).subtract({
    days: 89
  });
}

function authorizationExpired(validUntil: string, now: Temporal.Instant) {
  return Temporal.Instant.compare(Temporal.Instant.from(validUntil), now) <= 0;
}

export async function syncAccounts() {
  // The run id also owns the sync lease.
  return withLease(syncLease, "A sync is already running.", runSync, randomUUID());
}

async function runSync(runId: string) {
  let inserted = 0;
  const failures: {
    account: string;
    message: string;
    reconnect: boolean;
  }[] = [];

  try {
    const run = {
      startedAt: timestamp()
    };

    await startSyncRun(runId, run.startedAt);
    const accounts = await listSyncAccounts();

    if (accounts.length) {
      await verifyApplication();
    }

    const rules = await listRules();
    const ownIbans = new Set(accounts.map(account => (account.iban || "").replace(/\s/g, "")).filter(Boolean));
    const dateFrom = syncWindowStart().toString();
    const heartbeat = async () => {
      if (!(await renewLease(syncLease, runId))) {
        throw new SyncLeaseLost();
      }
    };

    for (const account of accounts) {
      try {
        await heartbeat();

        if (account.connection_status !== "LINKED" || !account.valid_until || authorizationExpired(account.valid_until, Temporal.Now.instant())) {
          await expireConnection(account.connection_id);

          throw new ReconnectRequired("Bank authorization has expired. Reconnect the bank.");
        }

        if (!account.provider_uid) {
          throw new ReconnectRequired("The account is missing its bank reference. Reconnect the bank.");
        }

        const balances = await fetchBalances(account.provider_uid);
        const transactions = await fetchTransactions(account.provider_uid, dateFrom, heartbeat);
        const entries = normalizeTransactions(transactions, ownIbans);

        await heartbeat();
        inserted += await saveAccountSync(run, account.id, account.currency, balances, entries, rules);
      } catch (error) {
        if (error instanceof SyncLeaseLost) {
          throw error;
        }

        const message = error instanceof HttpError ? error.message : "Sync could not be completed.";
        const sessionExpired = sessionEnded(error);

        await recordAccountSyncError(account.id, message);

        if (sessionExpired) {
          await expireEndedSession(account.connection_id);
        }

        failures.push({
          account: account.name,
          message,
          reconnect: sessionExpired || error instanceof ReconnectRequired
        });
      }
    }

    // Both bookings of a transfer between two synced accounts exist only once every account is stored.
    await heartbeat();
    await pairAllTransfers();

    const allFailed = accounts.length > 0 && failures.length === accounts.length;
    const partialStatus = failures.length ? "PARTIAL" : "SUCCESS";
    const status = allFailed ? "FAILED" : partialStatus;

    const failureLog = failures.map(failure => `${failure.account}: ${failure.message}`).join("\n");

    await finishSyncRun(runId, status, failureLog || null);

    return {
      inserted,
      status,
      failures,
      accounts: accounts.length
    };
  } catch (error) {
    if (error instanceof SyncLeaseLost) {
      await interruptSyncRun(runId, "The sync lost its lease and stopped.");
    } else {
      await finishSyncRun(runId, "FAILED", "Sync interrupted.");
    }

    throw error;
  }
}
