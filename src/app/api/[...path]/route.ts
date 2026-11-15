import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, environment } from "@/lib/db";
import { availableBanks, bankingConfigured, bankingRequest, verifyApplication } from "@/lib/enable-banking";
import { authenticated, checkPassword, cronAuthorized, hash, HttpError, requireAuth, requireOrigin, signedSession } from "@/lib/security";
import { minorUnits, MoneyError, validDate, viennaMonth } from "@/lib/money";
import { syncAccounts } from "@/lib/sync";
import { categorize, validatePattern, type Rule } from "@/lib/rules";
import { parseBalancesCsv, parseTransactionsCsv } from "@/lib/import";
import { transactionStatements } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const accountInput = z.object({ name: z.string().trim().min(1).max(100), institution: z.string().trim().min(1).max(100), kind: z.enum(["checking", "savings", "investment", "loan", "property", "credit_card"]), currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"), balance: z.string().max(30) });
const ruleInput = z.object({ name: z.string().trim().min(1).max(100), pattern: z.string().min(1).max(500), mode: z.enum(["keyword", "regex"]), category_id: z.string().min(1), priority: z.number().int().min(0).max(10000), enabled: z.boolean().default(true) });

async function state(request: Request) {
  const client = await db();
  const env = environment();
  const query = new URL(request.url).searchParams;
  const month = query.get("month") || viennaMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Invalid month.");
  const currency = query.get("currency") || "EUR";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(query.get("page")) || 1)));
  const where = ["a.environment=?", "t.currency=?"];
  const args: (string | number)[] = [env, currency];
  if (query.get("allMonths") !== "1") { where.push("substr(t.booking_date,1,7)=?"); args.push(month); }
  if (query.get("search")) { where.push("instr(lower(t.counterparty || ' ' || t.description),lower(?)) > 0"); args.push(query.get("search")!.slice(0, 200)); }
  if (query.get("account")) { where.push("a.id=?"); args.push(query.get("account")!); }
  if (query.get("category")) {
    if (query.get("category") === "uncategorized") where.push("t.category_id IS NULL");
    else { where.push("t.category_id=?"); args.push(query.get("category")!); }
  }
  const transactionWhere = where.join(" AND ");
  const [accounts, transactions, count, categories, rules, connections, runs, flows, breakdown, trend] = await Promise.all([
    client.execute({ sql: "SELECT a.*,r.valid_until FROM accounts a LEFT JOIN requisitions r ON r.id=a.requisition_id WHERE a.environment=? ORDER BY CASE a.kind WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 WHEN 'investment' THEN 2 ELSE 3 END,a.name", args: [env] }),
    client.execute({ sql: `SELECT t.*,a.name AS account_name,c.name AS category_name,c.color AS category_color,c.is_transfer FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE ${transactionWhere} ORDER BY t.booking_date DESC,t.created_at DESC,t.id LIMIT 50 OFFSET ?`, args: [...args, (page - 1) * 50] }),
    client.execute({ sql: `SELECT COUNT(*) AS n FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE ${transactionWhere}`, args }),
    client.execute("SELECT * FROM categories ORDER BY name"),
    client.execute("SELECT r.*,c.name AS category_name,c.color AS category_color FROM categorization_rules r JOIN categories c ON c.id=r.category_id ORDER BY priority,r.id"),
    client.execute({ sql: "SELECT id,bank_name,bank_country,CASE WHEN status='PENDING' AND state_expires_at < ? THEN 'EXPIRED' WHEN status='LINKED' AND valid_until < ? THEN 'EXPIRED' ELSE status END AS status,valid_until,error,created_at FROM requisitions WHERE environment=? ORDER BY created_at DESC LIMIT 20", args: [new Date().toISOString(), new Date().toISOString(), env] }),
    client.execute({ sql: "SELECT * FROM sync_runs WHERE environment=? ORDER BY started_at DESC LIMIT 5", args: [env] }),
    client.execute({ sql: "SELECT COALESCE(SUM(CASE WHEN t.amount_minor>0 THEN t.amount_minor ELSE 0 END),0) AS income, COALESCE(SUM(CASE WHEN t.amount_minor<0 THEN -t.amount_minor ELSE 0 END),0) AS expenses FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE a.environment=? AND t.currency=? AND substr(t.booking_date,1,7)=? AND COALESCE(c.is_transfer,0)=0", args: [env, currency, month] }),
    client.execute({ sql: "SELECT COALESCE(c.name,'Uncategorized') AS name,COALESCE(c.color,'#a2aaa5') AS color,SUM(-t.amount_minor) AS amount FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE a.environment=? AND t.currency=? AND substr(t.booking_date,1,7)=? AND t.amount_minor<0 AND COALESCE(c.is_transfer,0)=0 GROUP BY t.category_id ORDER BY amount DESC", args: [env, currency, month] }),
    client.execute({ sql: "SELECT substr(t.booking_date,1,7) AS month,SUM(CASE WHEN amount_minor>0 THEN amount_minor ELSE 0 END) AS income,SUM(CASE WHEN amount_minor<0 THEN -amount_minor ELSE 0 END) AS expenses FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN categories c ON c.id=t.category_id WHERE a.environment=? AND t.currency=? AND t.booking_date>=date(? || '-01','-5 months') AND t.booking_date<date(? || '-01','+1 month') AND COALESCE(c.is_transfer,0)=0 GROUP BY substr(t.booking_date,1,7)", args: [env, currency, month, month] }),
  ]);
  const relevant = accounts.rows.filter(account => account.currency === currency);
  const sum = (kinds: string[]) => relevant.filter(account => kinds.includes(String(account.kind))).reduce((total, account) => total + Number(account.balance_minor || 0), 0);
  return NextResponse.json({ environment: env, bankingConfigured: bankingConfigured(), passwordConfigured: Boolean(process.env.APP_PASSWORD), month, currency, page, accounts: accounts.rows, transactions: transactions.rows, transactionCount: Number(count.rows[0].n), categories: categories.rows, rules: rules.rows, connections: connections.rows, runs: runs.rows, summary: { netWorth: sum(["checking", "savings", "investment", "property", "credit_card", "loan"]), liquidity: sum(["checking", "savings", "credit_card"]), investments: sum(["investment"]), property: sum(["property"]), liabilities: sum(["loan"]), unvalued: relevant.filter(account => account.balance_minor === null).length, income: Number(flows.rows[0].income), expenses: Number(flows.rows[0].expenses) }, breakdown: breakdown.rows, trend: trend.rows });
}

async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const method = request.method;
    if (route === "auth/status" && method === "GET") return NextResponse.json({ authenticated: await authenticated() });
    if (route === "cron" && method === "GET") {
      if (!cronAuthorized(request)) throw new HttpError(401, "Cron access denied.");
      return NextResponse.json(await syncAccounts());
    }
    if (method !== "GET") requireOrigin(request);
    if (route === "auth/login" && method === "POST") {
      const { password } = z.object({ password: z.string().max(200) }).parse(await request.json());
      await checkPassword(password);
      const response = NextResponse.json({ ok: true });
      response.cookies.set("budget_session", signedSession(Date.now() + 7 * 86_400_000), { httpOnly: true, secure: new URL(process.env.APP_URL || "http://localhost:3000").protocol === "https:", sameSite: "lax", path: "/", maxAge: 7 * 86400 });
      return response;
    }
    await requireAuth();
    if (route === "auth/logout" && method === "POST") {
      const response = NextResponse.json({ ok: true });
      response.cookies.delete("budget_session");
      return response;
    }
    if (route === "state" && method === "GET") return state(request);
    if (route === "banks" && method === "GET") {
      const country = z.string().regex(/^[A-Z]{2}$/).parse(new URL(request.url).searchParams.get("country") || "AT");
      return NextResponse.json({ banks: await availableBanks(country) });
    }
    const client = await db();
    const env = environment();
    if (route === "banking/connect" && method === "POST") {
      const { bank, country } = z.object({ bank: z.string().min(1).max(200), country: z.string().regex(/^[A-Z]{2}$/) }).parse(await request.json());
      const banks = await availableBanks(country);
      const selected = banks.find(item => item.name === bank && item.country === country);
      if (!selected) throw new HttpError(400, "This bank is unavailable in the selected environment.");
      const callback = process.env.ENABLE_BANKING_REDIRECT_URL || `${process.env.APP_URL || "http://localhost:3000"}/api/banking/callback`;
      const application = await verifyApplication();
      if (!application.redirect_urls?.includes(callback)) throw new HttpError(409, "Register this exact callback URL in the Enable Banking application.");
      const state = randomBytes(32).toString("base64url");
      const browser = randomBytes(32).toString("base64url");
      const id = randomUUID();
      const validity = Math.min(Number(selected.maximum_consent_validity) || 86400, 180 * 86400);
      const authorization = await bankingRequest<{ url: string; authorization_id: string }>("/auth", { access: { valid_until: new Date(Date.now() + validity * 1000 - 60_000).toISOString(), balances: true, transactions: true }, aspsp: { name: bank, country }, state, redirect_url: callback, psu_type: "personal", language: "en" });
      if (new URL(authorization.url).protocol !== "https:") throw new HttpError(502, "Invalid bank redirect.");
      await client.execute({ sql: "INSERT INTO requisitions(id,environment,bank_name,bank_country,state_hash,browser_hash,state_expires_at,authorization_id) VALUES(?,?,?,?,?,?,?,?)", args: [id, env, bank, country, hash(state), hash(browser), new Date(Date.now() + 15 * 60_000).toISOString(), authorization.authorization_id] });
      const response = NextResponse.json({ url: authorization.url });
      response.cookies.set("budget_bank_flow", browser, { httpOnly: true, sameSite: "lax", secure: new URL(callback).protocol === "https:", path: "/api/banking/callback", maxAge: 900 });
      return response;
    }
    if (route === "sync" && method === "POST") return NextResponse.json(await syncAccounts());
    if (route === "accounts" && method === "POST") {
      const input = accountInput.parse(await request.json());
      const amount = minorUnits(input.balance, input.currency);
      if (input.kind === "loan" && amount > 0) throw new HttpError(422, "Enter outstanding debt as a negative balance.");
      const id = randomUUID();
      const date = new Date().toISOString().slice(0, 10);
      await client.batch([
        { sql: "INSERT INTO accounts(id,environment,name,institution,kind,currency,balance_minor,balance_date) VALUES(?,?,?,?,?,?,?,?)", args: [id, env, input.name, input.institution, input.kind, input.currency, amount, date] },
        { sql: "INSERT INTO balance_snapshots VALUES(?,?,?,?, 'manual')", args: [randomUUID(), id, date, amount] },
      ], "write");
      return NextResponse.json({ id }, { status: 201 });
    }
    if (path[0] === "accounts" && path[2] === "balance" && method === "POST") {
      const input = z.object({ balance: z.string().max(30), date: z.string().refine(validDate) }).parse(await request.json());
      const account = (await client.execute({ sql: "SELECT * FROM accounts WHERE id=? AND environment=? AND provider='manual'", args: [path[1], env] })).rows[0];
      if (!account) throw new HttpError(404, "Manual account not found.");
      const amount = minorUnits(input.balance, String(account.currency));
      if (account.kind === "loan" && amount > 0) throw new HttpError(422, "Enter outstanding debt as a negative balance.");
      if (input.date > new Date().toISOString().slice(0, 10)) throw new HttpError(422, "The valuation date cannot be in the future.");
      await client.batch([
        { sql: "INSERT INTO balance_snapshots VALUES(?,?,?,?, 'manual') ON CONFLICT(account_id,observed_at) DO UPDATE SET amount_minor=excluded.amount_minor,source='manual'", args: [randomUUID(), path[1], input.date, amount] },
        { sql: "UPDATE accounts SET balance_minor=?,balance_date=? WHERE id=? AND (balance_date IS NULL OR balance_date<=?)", args: [amount, input.date, path[1], input.date] },
      ], "write");
      return NextResponse.json({ ok: true });
    }
    if (route === "rules" && method === "POST") {
      const input = ruleInput.parse(await request.json());
      try { validatePattern(input.pattern, input.mode); } catch { throw new HttpError(422, "Invalid matching pattern. Regular expressions use safe RE2 syntax."); }
      const category = await client.execute({ sql: "SELECT id FROM categories WHERE id=?", args: [input.category_id] });
      if (!category.rows.length) throw new HttpError(422, "Category does not exist.");
      await client.execute({ sql: "INSERT INTO categorization_rules VALUES(?,?,?,?,?,?,?)", args: [randomUUID(), input.name, input.pattern, input.mode, input.category_id, input.priority, input.enabled ? 1 : 0] });
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (path[0] === "rules" && path.length === 2 && method === "PATCH") {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(await request.json());
      await client.execute({ sql: "UPDATE categorization_rules SET enabled=? WHERE id=?", args: [enabled ? 1 : 0, path[1]] });
      return NextResponse.json({ ok: true });
    }
    if (route === "rules/apply" && method === "POST") {
      const rules = (await client.execute("SELECT * FROM categorization_rules")).rows as unknown as Rule[];
      const rows = (await client.execute({ sql: "SELECT t.id,t.counterparty,t.description FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.environment=? AND t.category_source='rule' AND COALESCE(t.category_id,'')<>'transfer'", args: [env] })).rows;
      if (rows.length) await client.batch(rows.map(row => ({ sql: "UPDATE transactions SET category_id=? WHERE id=? AND category_source='rule'", args: [categorize(String(row.counterparty), String(row.description), rules), row.id] })), "write");
      return NextResponse.json({ updated: rows.length });
    }
    if (route === "categories" && method === "POST") {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(await request.json());
      await client.execute({ sql: "INSERT INTO categories(id,name,color) VALUES(?,?,'#638777')", args: [randomUUID(), name] });
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (path[0] === "transactions" && path.length === 2 && method === "PATCH") {
      const { category_id } = z.object({ category_id: z.string().min(1).nullable() }).parse(await request.json());
      if (category_id && !(await client.execute({ sql: "SELECT id FROM categories WHERE id=?", args: [category_id] })).rows.length) throw new HttpError(422, "Category does not exist.");
      const result = await client.execute({ sql: "UPDATE transactions SET category_id=?,category_source='manual' WHERE id=? AND account_id IN (SELECT id FROM accounts WHERE environment=?)", args: [category_id, path[1], env] });
      if (!result.rowsAffected) throw new HttpError(404, "Transaction not found.");
      return NextResponse.json({ ok: true });
    }
    if (route === "imports/transactions" && method === "POST") {
      const { account_id, csv } = z.object({ account_id: z.string(), csv: z.string().max(1_000_000) }).parse(await request.json());
      const account = (await client.execute({ sql: "SELECT * FROM accounts WHERE id=? AND environment=? AND provider='manual'", args: [account_id, env] })).rows[0];
      if (!account) throw new HttpError(404, "CSV import requires a manual account.");
      const entries = parseTransactionsCsv(csv, String(account.currency));
      const rules = (await client.execute("SELECT * FROM categorization_rules")).rows as unknown as Rule[];
      await client.batch(transactionStatements(account_id, entries, rules), "write");
      return NextResponse.json({ processed: entries.length, message: "Transactions imported. Update the current account balance separately." });
    }
    if (route === "imports/balances" && method === "POST") {
      const { account_id, csv } = z.object({ account_id: z.string(), csv: z.string().max(1_000_000) }).parse(await request.json());
      const account = (await client.execute({ sql: "SELECT * FROM accounts WHERE id=? AND environment=? AND provider='manual'", args: [account_id, env] })).rows[0];
      if (!account) throw new HttpError(404, "CSV import requires a manual account.");
      const entries = parseBalancesCsv(csv, String(account.currency));
      if (account.kind === "loan" && entries.some(entry => entry.amount > 0)) throw new HttpError(422, "Import outstanding debt as a negative balance.");
      const newest = entries[entries.length - 1];
      await client.batch([
        ...entries.map(entry => ({ sql: "INSERT INTO balance_snapshots VALUES(?,?,?,?, 'csv') ON CONFLICT(account_id,observed_at) DO UPDATE SET amount_minor=excluded.amount_minor,source='csv'", args: [randomUUID(), account_id, entry.date, entry.amount] })),
        { sql: "UPDATE accounts SET balance_minor=?,balance_date=? WHERE id=? AND (balance_date IS NULL OR balance_date<=?)", args: [newest.amount, newest.date, account_id, newest.date] },
      ], "write");
      return NextResponse.json({ processed: entries.length, message: "Valuation balances imported." });
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof MoneyError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Input is incomplete or invalid." }, { status: 400 });
    return NextResponse.json({ error: "The request could not be processed. Check the configuration and input." }, { status: 500 });
  }
}

export { handler as GET, handler as POST, handler as PATCH };
