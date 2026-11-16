import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { HttpError } from "@/lib/errors";
import { timestamp, today } from "@/lib/time";
import { database } from "@/server/database/connection";
import { acquireLease, releaseLease, renewLease } from "@/server/jobs/lease-repository";
import { listRules } from "@/features/categorization/server/rule-repository";
import { environment } from "./environment";
import { BankingError, bankingRequest, fetchTransactions, verifyApplication, type Balance } from "./enable-banking-client";
import { normalizeTransactions } from "./bank-data";
import { saveAccountSync } from "./account-sync-service";
import { finishSyncRun, listSyncAccounts, recordAccountSyncError, startSyncRun } from "./sync-repository";
import { expireConnection } from "./connection-repository";

const expiredSessionCodes = ["EXPIREDSESSION", "EXPIRED_SESSION", "INVALID_SESSION"];

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

export function syncLeaseName(environment: string) {
  return `sync:${environment}`;
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
  const db = await database();
  const env = environment();
  // The run id also owns the sync lease.
  const runId = randomUUID();
  const leaseName = syncLeaseName(env);

  if (!(await acquireLease(db, leaseName, runId))) {
    throw new HttpError(409, "A sync is already running.");
  }

  let inserted = 0;
  const failures: {
    account: string;
    message: string;
    reconnect: boolean;
  }[] = [];

  try {
    const run = {
      environment: env,
      startedAt: timestamp()
    };

    await startSyncRun(db, env, runId, run.startedAt);
    const accounts = await listSyncAccounts(db, env);

    if (accounts.length) {
      await verifyApplication();
    }

    const rules = await listRules();
    const ownIbans = new Set(accounts.map(account => (account.iban || "").replace(/\s/g, "")).filter(Boolean));
    const dateFrom = syncWindowStart().toString();
    const heartbeat = async () => {
      if (!(await renewLease(db, leaseName, runId))) {
        throw new SyncLeaseLost();
      }
    };

    for (const account of accounts) {
      try {
        await heartbeat();

        if (account.connection_status !== "LINKED" || !account.valid_until || authorizationExpired(account.valid_until, Temporal.Now.instant())) {
          await expireConnection(db, account.connection_id);

          throw new ReconnectRequired("Bank authorization has expired. Reconnect the bank.");
        }

        if (!account.provider_uid) {
          throw new ReconnectRequired("The account is missing its bank reference. Reconnect the bank.");
        }

        const balanceResult = await bankingRequest<{
          balances: Balance[]
        }>(`/accounts/${encodeURIComponent(account.provider_uid)}/balances`);
        const transactions = await fetchTransactions(account.provider_uid, dateFrom, heartbeat);
        const entries = normalizeTransactions(transactions, ownIbans);

        await heartbeat();
        inserted += await saveAccountSync(db, run, account.id, account.currency, balanceResult.balances, entries, rules);
      } catch (error) {
        if (error instanceof SyncLeaseLost) {
          throw error;
        }

        const message = error instanceof HttpError ? error.message : "Sync could not be completed.";
        const sessionExpired = error instanceof BankingError && expiredSessionCodes.includes(error.code);

        await recordAccountSyncError(db, account.id, env, message);

        if (sessionExpired) {
          await expireConnection(db, account.connection_id);
        }

        failures.push({
          account: account.name,
          message,
          reconnect: sessionExpired || error instanceof ReconnectRequired
        });
      }
    }

    const allFailed = accounts.length > 0 && failures.length === accounts.length;
    const partialStatus = failures.length ? "PARTIAL" : "SUCCESS";
    const status = allFailed ? "FAILED" : partialStatus;

    const failureLog = failures.map(failure => `${failure.account}: ${failure.message}`).join("\n");

    await finishSyncRun(db, runId, status, failureLog || null);

    return {
      inserted,
      status,
      failures,
      accounts: accounts.length
    };
  } catch (error) {
    if (!(error instanceof SyncLeaseLost)) {
      await finishSyncRun(db, runId, "FAILED", "Sync interrupted.");
    }

    throw error;
  } finally {
    await releaseLease(db, leaseName, runId);
  }
}
