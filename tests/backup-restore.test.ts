import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { initializeDatabase } from "../src/server/database/migrations";
import { verifyLocalBackup } from "../src/server/database/backup-verification";
import type { Database } from "../src/server/database/connection";
import * as schema from "../src/server/database/schema";
import { encrypt } from "../src/server/security/secret-box";
import { provisionUser } from "../src/features/auth/server/provision-user";
import { handleAuthentication } from "../src/features/auth/server/auth-handler";
import { requireAuth } from "../src/features/auth/server/session";
import { syncAccounts } from "../src/features/banking/server/sync-service";

function fingerprint(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function localFixture(context: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ufer-offline-restore-"));
  const file = join(directory, "source.sqlite");
  const client = createClient({
    url: `file:${file}`
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  context.after(() => {
    client.close();
    rmSync(directory, {
      recursive: true,
      force: true
    });
  });

  return {
    directory,
    file,
    client,
    db
  };
}

function testEnvironment(context: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));

  Object.assign(process.env, values);
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("a consistent WAL backup restores credentials, manual corrections and bank access on a fresh local database", async context => {
  const {
    directory,
    file,
    client,
    db
  } = await localFixture(context);
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousFetch = globalThis.fetch;
  const origin = "https://restore.example";
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048
  }).privateKey.export({
    type: "pkcs8",
    format: "pem"
  }).toString();

  testEnvironment(context, {
    APP_URL: origin,
    BETTER_AUTH_SECRET: "synthetic-offline-restore-secret-with-32-characters",
    DATA_ENCRYPTION_KEY: "ab".repeat(32),
    ENABLE_BANKING_ENVIRONMENT: "SANDBOX",
    ENABLE_BANKING_APP_ID: "synthetic-restore-app",
    ENABLE_BANKING_PRIVATE_KEY: key,
    ENABLE_BANKING_PRIVATE_KEY_PATH: ""
  });
  globals.budgetDb = Promise.resolve(db);
  context.after(() => {
    globals.budgetDb = previousDatabase;
    globalThis.fetch = previousFetch;
  });
  await provisionUser({
    username: "restore_owner",
    email: "restore@example.test",
    name: "Synthetic owner",
    password: "synthetic-restore-password-123",
    role: "owner"
  });
  await client.execute("PRAGMA journal_mode=WAL");
  await db.insert(schema.requisitions).values({
    id: "bank",
    environment: "SANDBOX",
    bank_name: "Example bank",
    bank_country: "AT",
    status: "LINKED",
    valid_until: "2099-01-01T00:00:00.000Z",
    session_cipher: encrypt("synthetic-bank-session")
  });
  await db.insert(schema.accounts).values({
    id: "checking",
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example bank",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "synthetic-bank-account",
    requisition_id: "bank",
    balance_minor: 12000,
    balance_date: "2026-01-01"
  });
  await db.insert(schema.transactions).values({
    id: "corrected",
    account_id: "checking",
    provider_reference: "bank:existing",
    booking_date: "2026-01-01",
    amount_minor: -500,
    currency: "EUR",
    category_id: "groceries",
    category_source: "manual",
    type: "expense"
  });
  assert.equal(existsSync(`${file}-wal`), true);
  const before = await db.select().from(schema.transactions);
  const restoredFile = join(directory, "restored.sqlite");
  const source = new DatabaseSync(file, {
    readOnly: true
  });

  try {
    await backup(source, restoredFile);
  } finally {
    source.close();
  }

  const copiedHash = fingerprint(restoredFile);
  const report = verifyLocalBackup(restoredFile, {
    checkBankSecrets: true
  });

  assert.equal(report.counts.accounts, 1);
  assert.equal(report.counts.auth_users, 1);
  assert.equal(report.counts.transactions, 1);
  assert.equal(report.bankSessionSecrets, "verified");
  const commandReport = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/verify-backup.ts", `--file=${restoredFile}`, "--check-bank-secrets"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "libsql://must-not-connect.invalid"
    },
    stdio: "pipe"
  }));

  assert.deepEqual(commandReport, report);
  assert.equal(fingerprint(restoredFile), copiedHash);
  const restoredClient = createClient({
    url: `file:${restoredFile}`
  });

  context.after(() => restoredClient.close());
  const restored = drizzle(restoredClient, {
    schema
  });

  globals.budgetDb = Promise.resolve(restored);
  assert.deepEqual(await restored.select().from(schema.transactions), before);
  const signIn = await handleAuthentication(new Request(`${origin}/api/auth/sign-in/username`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: "restore_owner",
      password: "synthetic-restore-password-123"
    })
  }));

  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.getSetCookie().find(value => value.startsWith("__Secure-better-auth.session_token="))?.split(";")[0];

  assert.ok(cookie);
  assert.equal((await requireAuth(new Request(`${origin}/api/me`, {
    headers: {
      cookie
    }
  }))).username, "restore_owner");
  const requests: string[] = [];

  globalThis.fetch = async input => {
    const url = new URL(String(input));

    requests.push(url.pathname);

    if (url.pathname === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    if (url.pathname.endsWith("/balances")) {
      return Response.json({
        balances: [{
          balance_type: "CLBD",
          balance_amount: {
            amount: "130.00",
            currency: "EUR"
          },
          reference_date: "2026-01-02"
        }]
      });
    }

    if (url.pathname.endsWith("/transactions")) {
      return Response.json({
        transactions: [],
        continuation_key: null
      });
    }

    throw new Error("Unexpected synthetic provider request.");
  };

  assert.equal((await syncAccounts()).status, "SUCCESS");
  assert.ok(requests.includes("/accounts/synthetic-bank-account/balances"));
  assert.equal((await restored.select().from(schema.accounts).get())?.balance_minor, 13000);
  assert.deepEqual(await restored.select().from(schema.transactions), before);
  assert.equal((await db.select().from(schema.accounts).get())?.balance_minor, 12000);
});

test("local verification leaves bank keys unchecked unless requested and rejects a mismatched key without changing data", async context => {
  const {
    file,
    db
  } = await localFixture(context);

  testEnvironment(context, {
    DATA_ENCRYPTION_KEY: "ab".repeat(32),
    DATABASE_URL: "libsql://must-not-connect.invalid"
  });
  await db.insert(schema.requisitions).values({
    id: "encrypted",
    environment: "SANDBOX",
    bank_name: "Example bank",
    bank_country: "AT",
    session_cipher: encrypt("synthetic-session")
  });
  const before = fingerprint(file);

  process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
  assert.equal(verifyLocalBackup(file).bankSessionSecrets, "not_checked");
  assert.throws(() => verifyLocalBackup(file, {
    checkBankSecrets: true
  }), /could not be decrypted/);
  assert.equal(fingerprint(file), before);
});

test("verification rejects broken references and changed migration history instead of repairing the artifact", async context => {
  const {
    file,
    client
  } = await localFixture(context);

  await client.execute("PRAGMA foreign_keys=OFF");
  await client.execute("INSERT INTO balance_snapshots(id,account_id,observed_at,amount_minor,source) VALUES('orphan','missing','2026-01-01',100,'sync')");
  const brokenHash = fingerprint(file);

  assert.throws(() => verifyLocalBackup(file), /foreign-key/);
  assert.equal(fingerprint(file), brokenHash);
  await client.execute("DELETE FROM balance_snapshots WHERE id='orphan'");
  const changed = await client.execute("UPDATE __drizzle_migrations SET hash='synthetic-altered-history' WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)");

  assert.equal(changed.rowsAffected, 1);
  const alteredHash = fingerprint(file);

  assert.throws(() => verifyLocalBackup(file), /Migration history differs/);
  assert.equal(fingerprint(file), alteredHash);
});

test("missing, corrupt and pending artifacts are rejected without file creation or migration", async context => {
  const {
    directory,
    file,
    client
  } = await localFixture(context);
  const missing = join(directory, "missing.sqlite");

  assert.throws(() => verifyLocalBackup("libsql://must-not-connect.invalid"), /local filesystem path/);
  assert.throws(() => verifyLocalBackup(missing));
  assert.equal(existsSync(missing), false);
  const corrupt = join(directory, "corrupt.sqlite");

  writeFileSync(corrupt, "synthetic invalid database");
  assert.throws(() => verifyLocalBackup(corrupt));
  await client.execute("DELETE FROM __drizzle_migrations WHERE created_at=(SELECT MAX(created_at) FROM __drizzle_migrations)");
  const before = fingerprint(file);

  assert.throws(() => verifyLocalBackup(file), /matching the backup's applied migrations/);
  assert.equal(fingerprint(file), before);
});


test("verification rejects a WAL-backed file whose committed rows are absent from the main file alone", async context => {
  const {
    directory,
    file,
    client,
    db
  } = await localFixture(context);

  await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA wal_autocheckpoint=0");
  await db.insert(schema.accounts).values({
    id: "wal-only",
    environment: "SANDBOX",
    name: "Synthetic WAL account",
    institution: "Example bank",
    kind: "checking"
  });
  assert.ok(statSync(`${file}-wal`).size > 0);
  const fileOnly = join(directory, "incomplete-file-only.sqlite");

  copyFileSync(file, fileOnly);
  const incomplete = new DatabaseSync(fileOnly, {
    readOnly: true
  });

  try {
    assert.equal(incomplete.prepare("SELECT COUNT(*) AS count FROM accounts").get()?.count, 0);
  } finally {
    incomplete.close();
  }

  const before = fingerprint(file);

  assert.throws(() => verifyLocalBackup(file), /self-contained/);
  const link = join(directory, "backup-link.sqlite");

  symlinkSync(file, link);
  assert.throws(() => verifyLocalBackup(link), /self-contained/);
  assert.equal(fingerprint(file), before);
});
