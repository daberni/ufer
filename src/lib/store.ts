import { randomUUID } from "node:crypto";
import type { Client, InStatement } from "@libsql/client";
import { categorize, type Rule } from "./rules";
import { minorUnits, validDate } from "./money";
import { HttpError } from "./security";
import type { BankAccount, BankTransaction, Balance } from "./enable-banking";

export type Entry = { reference: string; date: string; amount: number; currency: string; counterparty: string; description: string; transfer?: boolean };

export function normalizeTransactions(transactions: BankTransaction[], ownIbans: Set<string>): Entry[] {
  const references = new Map<string, string>();
  return transactions.filter(item => item.status === "BOOK").map(item => {
    const date = item.booking_date || item.value_date || "";
    if (!validDate(date)) throw new HttpError(422, "A booked bank transaction is missing a valid booking date.");
    // transaction_id is not guaranteed unique by Enable Banking. Never silently merge unrelated payments.
    if (!item.entry_reference) throw new HttpError(422, "The bank returned booked transactions without a stable entry_reference. Import stopped to prevent duplicates.");
    const absolute = minorUnits(item.transaction_amount.amount, item.transaction_amount.currency);
    if (absolute < 0 || !["DBIT", "CRDT"].includes(item.credit_debit_indicator)) throw new HttpError(422, "The bank returned an invalid debit/credit indicator.");
    const debit = item.credit_debit_indicator === "DBIT";
    const counterparty = (debit ? item.creditor?.name : item.debtor?.name) || "";
    const counterIban = (debit ? item.creditor_account?.iban : item.debtor_account?.iban)?.replace(/\s/g, "");
    const entry: Entry = { reference: `bank:${item.entry_reference}`, date, amount: debit ? -absolute : absolute, currency: item.transaction_amount.currency, counterparty, description: item.remittance_information?.join(" · ") || item.note || "", transfer: Boolean(counterIban && ownIbans.has(counterIban)) };
    const signature = JSON.stringify([entry.date, entry.amount, entry.currency, entry.counterparty, entry.description]);
    const previous = references.get(entry.reference);
    if (previous && previous !== signature) throw new HttpError(422, "The bank returned the same reference for different transactions. Import stopped.");
    references.set(entry.reference, signature);
    return entry;
  });
}

export function transactionStatements(accountId: string, entries: Entry[], rules: Rule[]): InStatement[] {
  return entries.map(entry => {
    const category = entry.transfer ? "transfer" : categorize(entry.counterparty, entry.description, rules);
    return {
      sql: `INSERT INTO transactions(id,account_id,provider_reference,booking_date,amount_minor,currency,counterparty,description,category_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,provider_reference) DO UPDATE SET booking_date=excluded.booking_date, amount_minor=excluded.amount_minor, currency=excluded.currency, counterparty=excluded.counterparty, description=excluded.description, category_id=CASE WHEN transactions.category_source='manual' THEN transactions.category_id ELSE excluded.category_id END`,
      args: [randomUUID(), accountId, entry.reference, entry.date, entry.amount, entry.currency, entry.counterparty, entry.description, category],
    };
  });
}

export function selectedBalance(balances: Balance[], currency: string) {
  for (const type of ["CLBD", "ITBD", "CLAV", "ITAV", "PRCD", "XPCD"]) {
    const balance = balances.find(item => item.balance_type === type && item.balance_amount.currency === currency);
    if (balance) return { amount: minorUnits(balance.balance_amount.amount, currency), date: balance.reference_date || new Date().toISOString().slice(0, 10) };
  }
  throw new HttpError(422, "The bank did not return a supported balance for this account currency.");
}

export async function saveSessionAccounts(client: Client, env: string, requisitionId: string, institution: string, accounts: BankAccount[]) {
  const tx = await client.transaction("write");
  try {
    for (const account of accounts) {
      if (!account.identification_hash || !account.uid || !account.currency || account.currency === "XXX") throw new HttpError(422, "Bank account is missing a stable identifier or an unambiguous currency.");
      const hashes = [...new Set([account.identification_hash, ...(account.identification_hashes || [])])];
      const matches = await tx.execute({ sql: `SELECT DISTINCT account_id FROM account_identifiers WHERE environment=? AND identification_hash IN (${hashes.map(() => "?").join(",")})`, args: [env, ...hashes] });
      if (matches.rows.length > 1) throw new HttpError(409, "Bank identifiers match multiple existing accounts. Check the account mapping.");
      const id = matches.rows[0]?.account_id as string || randomUUID();
      const exists = matches.rows.length > 0;
      if (exists) {
        await tx.execute({ sql: "UPDATE accounts SET provider_uid=?,requisition_id=?,iban=COALESCE(?,iban),sync_error=NULL WHERE id=? AND environment=? AND currency=?", args: [account.uid, requisitionId, account.account_id?.iban || null, id, env, account.currency] });
        const saved = await tx.execute({ sql: "SELECT currency FROM accounts WHERE id=?", args: [id] });
        if (saved.rows[0].currency !== account.currency) throw new HttpError(409, "The account currency has changed; automatic mapping stopped.");
      } else {
        await tx.execute({ sql: "INSERT INTO accounts(id,environment,name,institution,kind,currency,provider,provider_uid,requisition_id,iban) VALUES(?,?,?,?,?,?, 'enable_banking',?,?,?)", args: [id, env, account.name || account.product || institution, institution, "checking", account.currency, account.uid, requisitionId, account.account_id?.iban || null] });
      }
      for (const identification of hashes) await tx.execute({ sql: "INSERT OR IGNORE INTO account_identifiers VALUES(?,?,?)", args: [env, identification, id] });
    }
    await tx.execute({ sql: "UPDATE requisitions SET status='SUPERSEDED' WHERE environment=? AND status='LINKED' AND id<>? AND NOT EXISTS(SELECT 1 FROM accounts WHERE accounts.requisition_id=requisitions.id)", args: [env, requisitionId] });
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}

export async function saveAccountSync(client: Client, accountId: string, currency: string, balances: Balance[], entries: Entry[], rules: Rule[]) {
  if (entries.some(entry => entry.currency !== currency)) throw new HttpError(422, "The transaction currency does not match the account currency.");
  const balance = selectedBalance(balances, currency);
  const now = new Date().toISOString();
  const tx = await client.transaction("write");
  try {
    const before = await tx.execute({ sql: "SELECT COUNT(*) AS n FROM transactions WHERE account_id=?", args: [accountId] });
    const statements = transactionStatements(accountId, entries, rules);
    for (let offset = 0; offset < statements.length; offset += 100) await tx.batch(statements.slice(offset, offset + 100));
    await tx.execute({ sql: "UPDATE accounts SET balance_minor=?,balance_date=?,last_synced_at=?,sync_error=NULL WHERE id=?", args: [balance.amount, balance.date, now, accountId] });
    await tx.execute({ sql: "INSERT INTO balance_snapshots VALUES(?,?,?,?, 'sync') ON CONFLICT(account_id,observed_at) DO UPDATE SET amount_minor=excluded.amount_minor", args: [randomUUID(), accountId, balance.date, balance.amount] });
    const after = await tx.execute({ sql: "SELECT COUNT(*) AS n FROM transactions WHERE account_id=?", args: [accountId] });
    await tx.commit();
    return Number(after.rows[0].n) - Number(before.rows[0].n);
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}

export async function acquireLease(client: Client, name: string, owner: string, now = new Date()) {
  const expires = new Date(now.getTime() + 12 * 60_000).toISOString();
  const result = await client.execute({ sql: "INSERT INTO leases VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE leases.expires_at < ? RETURNING owner", args: [name, owner, expires, now.toISOString()] });
  return result.rows.length === 1;
}
