import { randomUUID } from "node:crypto";
import { db, environment } from "./db";
import { BankingError, bankingRequest, fetchTransactions, verifyApplication, type Balance } from "./enable-banking";
import { acquireLease, normalizeTransactions, saveAccountSync } from "./store";
import { HttpError } from "./security";
import type { Rule } from "./rules";

export async function syncAccounts() {
  const client = await db();
  const env = environment();
  const owner = randomUUID();
  const leaseName = `sync:${env}`;
  if (!await acquireLease(client, leaseName, owner)) throw new HttpError(409, "A sync is already running.");
  const started = new Date().toISOString();
  await client.execute({ sql: "UPDATE sync_runs SET status='INTERRUPTED',finished_at=?,error='Vorheriger Sync wurde unterbrochen.' WHERE environment=? AND status='RUNNING'", args: [started, env] });
  await client.execute({ sql: "INSERT INTO sync_runs(id,environment,started_at,status) VALUES(?,?,?,'RUNNING')", args: [owner, env, started] });
  let inserted = 0;
  const failures: string[] = [];
  try {
    const accounts = await client.execute({ sql: "SELECT a.*,r.valid_until,r.status AS connection_status FROM accounts a JOIN requisitions r ON r.id=a.requisition_id WHERE a.environment=? AND a.provider='enable_banking'", args: [env] });
    if (accounts.rows.length) await verifyApplication();
    const rules = (await client.execute("SELECT * FROM categorization_rules")).rows as unknown as Rule[];
    const ownIbans = new Set(accounts.rows.map(account => String(account.iban || "").replace(/\s/g, "")).filter(Boolean));
    const dateFrom = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
    const heartbeat = async () => {
      const renewed = await client.execute({ sql: "UPDATE leases SET expires_at=? WHERE name=? AND owner=? RETURNING owner", args: [new Date(Date.now() + 12 * 60_000).toISOString(), leaseName, owner] });
      if (!renewed.rows.length) throw new HttpError(409, "Sync lease lost; run sync again.");
    };
    for (const account of accounts.rows) {
      const accountId = String(account.id);
      try {
        await heartbeat();
        if (account.connection_status !== "LINKED" || !account.valid_until || Date.parse(String(account.valid_until)) <= Date.now()) {
          await client.execute({ sql: "UPDATE requisitions SET status='EXPIRED' WHERE id=?", args: [account.requisition_id] });
          throw new HttpError(409, "Bank authorization has expired. Reconnect the bank.");
        }
        const balanceResult = await bankingRequest<{ balances: Balance[] }>(`/accounts/${encodeURIComponent(String(account.provider_uid))}/balances`);
        const transactions = await fetchTransactions(String(account.provider_uid), dateFrom, heartbeat);
        await heartbeat();
        inserted += await saveAccountSync(client, accountId, String(account.currency), balanceResult.balances, normalizeTransactions(transactions, ownIbans), rules);
      } catch (error) {
        const message = error instanceof HttpError ? error.message : "Sync could not be completed.";
        await client.execute({ sql: "UPDATE accounts SET sync_error=? WHERE id=?", args: [message, accountId] });
        if (error instanceof BankingError && ["EXPIREDSESSION", "EXPIRED_SESSION", "INVALID_SESSION"].includes(error.code)) await client.execute({ sql: "UPDATE requisitions SET status='EXPIRED' WHERE id=?", args: [account.requisition_id] });
        failures.push(`${account.name}: ${message}`);
      }
    }
    const status = failures.length ? "PARTIAL" : "SUCCESS";
    await client.execute({ sql: "UPDATE sync_runs SET status=?,finished_at=?,inserted_count=?,error=? WHERE id=?", args: [status, new Date().toISOString(), inserted, failures.join("\n") || null, owner] });
    return { inserted, status, failures, accounts: accounts.rows.length };
  } catch (error) {
    await client.execute({ sql: "UPDATE sync_runs SET status='FAILED',finished_at=?,error=? WHERE id=?", args: [new Date().toISOString(), "Sync interrupted.", owner] });
    throw error;
  } finally {
    await client.execute({ sql: "DELETE FROM leases WHERE name=? AND owner=?", args: [leaseName, owner] });
  }
}

export async function completeAuthorization(state: string, browserSecret: string, code: string) {
  const { hash, encrypt } = await import("./security");
  const { saveSessionAccounts } = await import("./store");
  const client = await db();
  const env = environment();
  const connection = await client.execute({ sql: "UPDATE requisitions SET used_at=?,status='EXCHANGING' WHERE state_hash=? AND browser_hash=? AND environment=? AND used_at IS NULL AND state_expires_at > ? AND status='PENDING' RETURNING *", args: [new Date().toISOString(), hash(state), hash(browserSecret), env, new Date().toISOString()] });
  if (connection.rows.length !== 1) throw new HttpError(400, "The bank callback has expired, has already been used, or belongs to another browser.");
  const row = connection.rows[0];
  try {
    const session = await bankingRequest<import("./enable-banking").BankSession>("/sessions", { code });
    if (session.aspsp.name !== row.bank_name || session.aspsp.country !== row.bank_country || !session.session_id || !session.access?.valid_until) throw new HttpError(502, "The bank callback does not match the requested connection.");
    // Save the once-only session response before starting any subsequent API requests.
    await client.execute({ sql: "UPDATE requisitions SET session_cipher=?,valid_until=?,status='LINKED',error=NULL WHERE id=?", args: [encrypt(session.session_id), session.access.valid_until, row.id] });
    await saveSessionAccounts(client, env, String(row.id), String(row.bank_name), session.accounts);
    if (!session.accounts.length) await client.execute({ sql: "UPDATE requisitions SET error=? WHERE id=?", args: ["No accounts were authorized. Restricted production applications require accounts to be linked in the provider control panel first.", row.id] });
    return { accounts: session.accounts.length };
  } catch (error) {
    await client.execute({ sql: "UPDATE requisitions SET status='ERROR',error=? WHERE id=?", args: [error instanceof HttpError ? error.message : "Bank connection failed.", row.id] });
    throw error;
  }
}
