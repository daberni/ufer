import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/errors";
import { database } from "@/server/database/connection";
import { acquireLease, releaseLease, renewLease } from "@/server/jobs/lease-repository";
import { listRules } from "@/features/categorization/server/rule-repository";
import { environment } from "./environment";
import { BankingError, bankingRequest, fetchTransactions, verifyApplication, type Balance } from "./enable-banking-client";
import { normalizeTransactions } from "./bank-data";
import { saveAccountSync } from "./account-sync-service";
import { finishSyncRun, listSyncAccounts, recordAccountSyncError, startSyncRun } from "./sync-repository";
import { expireConnection } from "./connection-repository";

export async function syncAccounts() {
  const db = await database();
  const env = environment();
  const owner = randomUUID();
  const leaseName = `sync:${env}`;

  if (!(await acquireLease(db, leaseName, owner))) {
    throw new HttpError(409, "A sync is already running.");
  }

  let inserted = 0;
  const failures: string[] = [];

  try {
    await startSyncRun(db, env, owner, new Date().toISOString());
    const accounts = await listSyncAccounts(db, env);

    if (accounts.length) {
      await verifyApplication();
    }

    const rules = await listRules();
    const ownIbans = new Set(accounts.map(account => (account.iban || "").replace(/\s/g, "")).filter(Boolean));
    const dateFrom = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
    const heartbeat = async () => {
      if (!(await renewLease(db, leaseName, owner))) {
        throw new HttpError(409, "Sync lease lost; run sync again.");
      }
    };

    for (const account of accounts) {
      try {
        await heartbeat();

        if (account.connection_status !== "LINKED" || !account.valid_until || Date.parse(account.valid_until) <= Date.now()) {
          await expireConnection(db, account.connection_id);

          throw new HttpError(409, "Bank authorization has expired. Reconnect the bank.");
        }

        if (!account.provider_uid) {
          throw new HttpError(409, "The account is missing its bank reference. Reconnect the bank.");
        }

        const balanceResult = await bankingRequest<{
          balances: Balance[]
        }>(`/accounts/${encodeURIComponent(account.provider_uid)}/balances`);
        const transactions = await fetchTransactions(account.provider_uid, dateFrom, heartbeat);
        const entries = normalizeTransactions(transactions, ownIbans);

        await heartbeat();
        inserted += await saveAccountSync(db, account.id, account.currency, balanceResult.balances, entries, rules);
      } catch (error) {
        const message = error instanceof HttpError ? error.message : "Sync could not be completed.";

        await recordAccountSyncError(db, account.id, env, message);

        if (error instanceof BankingError && ["EXPIREDSESSION", "EXPIRED_SESSION", "INVALID_SESSION"].includes(error.code)) {
          await expireConnection(db, account.connection_id);
        }

        failures.push(`${account.name}: ${message}`);
      }
    }

    const status = failures.length ? "PARTIAL" : "SUCCESS";

    await finishSyncRun(db, owner, status, inserted, failures.join("\n") || null);

    return {
      inserted,
      status,
      failures,
      accounts: accounts.length
    };
  } catch (error) {
    await finishSyncRun(db, owner, "FAILED", 0, "Sync interrupted.");

    throw error;
  } finally {
    await releaseLease(db, leaseName, owner);
  }
}
