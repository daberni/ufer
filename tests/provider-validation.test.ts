import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import type { AuthContext } from "../src/features/auth/server/session";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { decrypt, encrypt } from "../src/server/security/secret-box";
import { hash } from "../src/server/security/tokens";
import { cancelAuthorization, completeAuthorization } from "../src/features/banking/server/authorization-service";
import { connectBank } from "../src/features/banking/server/connect-bank";
import { availableBanks } from "../src/features/banking/server/enable-banking-client";
import { removeBankConnection } from "../src/features/banking/server/connection-service";
import { syncAccounts } from "../src/features/banking/server/sync-service";
import { seedActor } from "./fixtures/auth";

const providerKey = generateKeyPairSync("rsa", {
  modulusLength: 2048
}).privateKey.export({
  type: "pkcs8",
  format: "pem"
}).toString();

const callback = "https://ufer.example/api/banking/callback";

const environmentNames = ["ENABLE_BANKING_ENVIRONMENT", "ENABLE_BANKING_APP_ID", "ENABLE_BANKING_PRIVATE_KEY", "ENABLE_BANKING_REDIRECT_URL", "DATA_ENCRYPTION_KEY"];

type ProviderRequest = {
  method: string;
  path: string;
};

type Provider = (request: ProviderRequest) => Response;

async function providerDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousFetch = globalThis.fetch;
  const previousEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
  const requests: string[] = [];
  const state: {
    provider: Provider
  } = {
    provider: () => Response.json({})
  };

  context.after(() => {
    globals.budgetDb = previousDatabase;
    globalThis.fetch = previousFetch;

    for (const name of environmentNames) {
      if (previousEnvironment[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previousEnvironment[name];
      }
    }

    client.close();
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  process.env.ENABLE_BANKING_APP_ID = "synthetic-app";
  process.env.ENABLE_BANKING_PRIVATE_KEY = providerKey;
  process.env.ENABLE_BANKING_REDIRECT_URL = callback;
  process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
  globalThis.fetch = async (input, init) => {
    const request = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname
    };

    requests.push(`${request.method} ${request.path}`);

    return state.provider(request);
  };

  const actor = await seedActor(db);

  return {
    db,
    actor,
    requests,
    useProvider(provider: Provider) {
      state.provider = provider;
    }
  };
}

async function insertPendingAuthorization(db: Database, actor: AuthContext, id: string) {
  await db.insert(schema.requisitions).values({
    id,
    workspace_id: actor.workspaceId,
    initiated_by_user_id: actor.userId,
    auth_session_id: actor.sessionId,
    bank_name: "Example institution",
    bank_country: "AT",
    state_hash: hash(`state-${id}`),
    browser_hash: hash("browser"),
    state_expires_at: "2099-01-01T00:00:00.000Z"
  });
}

function authorize(id: string, actor: AuthContext) {
  return completeAuthorization(`state-${id}`, "browser", "synthetic-code", actor);
}

async function insertLinkedConnection(db: Database, id: string, accountId: string) {
  await db.insert(schema.requisitions).values({
    id,
    bank_name: "Example institution",
    bank_country: "AT",
    status: "LINKED",
    valid_until: "2099-01-01T00:00:00.000Z",
    session_cipher: encrypt(`${id}-session`)
  });
  await db.insert(schema.accounts).values({
    id: accountId,
    name: "Synthetic account",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: `uid-${accountId}`,
    requisition_id: id
  });
  await db.insert(schema.accountIdentifiers).values({
    identification_hash: `hash-${accountId}`,
    account_id: accountId
  });
}

function session(sessionId: string, identificationHash: string, overrides: Record<string, unknown> = {}) {
  return {
    session_id: sessionId,
    aspsp: {
      name: "Example institution",
      country: "AT"
    },
    access: {
      valid_until: "2099-01-01T00:00:00Z"
    },
    accounts: [{
      uid: `uid-${sessionId}`,
      identification_hash: identificationHash,
      currency: "EUR"
    }],
    ...overrides
  };
}

const balances = {
  balances: [{
    balance_type: "CLBD",
    balance_amount: {
      amount: "100.00",
      currency: "EUR"
    },
    reference_date: null
  }]
};

const bookedTransaction = {
  entry_reference: "synthetic-reference",
  status: "BOOK",
  booking_date: "2026-11-12",
  transaction_amount: {
    amount: "12.50",
    currency: "EUR"
  },
  credit_debit_indicator: "DBIT",
  remittance_information: ["Synthetic purchase"]
};

async function connection(db: Database, id: string) {
  return db.select().from(schema.requisitions).where(eq(schema.requisitions.id, id)).get();
}

test("a missing session ID is rejected without attempting revocation", async context => {
  context.mock.method(console, "warn", () => {});
  const {
    db,
    actor,
    requests,
    useProvider
  } = await providerDatabase(context);
  const malformedSessions = {
    "missing-session-id": session("", "hash-d")
  };

  for (const [id, body] of Object.entries(malformedSessions)) {
    await insertPendingAuthorization(db, actor, id);
    useProvider(() => Response.json(body));

    await assert.rejects(authorize(id, actor), {
      status: 502,
      message: "Enable Banking returned an unexpected response."
    });

    const stored = await connection(db, id);

    assert.equal(stored?.status, "ERROR");
    assert.equal(stored?.session_cipher, null);
    assert.equal(stored?.valid_until, null);
  }

  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal(requests.filter(request => request.startsWith("DELETE")).length, 0);
});

for (const revocationStatus of [204, 503]) {
  test(`malformed session accounts retain cleanup credentials until revocation is confirmed (${revocationStatus})`, async context => {
    context.mock.method(console, "warn", () => {});
    const {
      db,
      actor,
      requests,
      useProvider
    } = await providerDatabase(context);

    await insertPendingAuthorization(db, actor, "invalid-accounts");
    useProvider(({ method }) => method === "DELETE" ? new Response(null, {
      status: revocationStatus
    }) : Response.json(session("invalid-account-session", "unused", {
      accounts: [{
        uid: "account",
        currency: "EUR"
      }]
    })));

    await assert.rejects(authorize("invalid-accounts", actor), {
      status: 502,
      message: "Enable Banking returned an unexpected response."
    });
    assert.deepEqual(requests, ["POST /sessions", "DELETE /sessions/invalid-account-session"]);
    assert.equal((await connection(db, "invalid-accounts"))?.status, "ERROR");
    const stored = await connection(db, "invalid-accounts");

    if (revocationStatus === 204) {
      assert.equal(stored?.session_cipher, null);
    } else {
      assert.equal(decrypt(String(stored?.session_cipher)), "invalid-account-session");
    }

    assert.equal((await db.select().from(schema.accounts)).length, 0);
  });

}

for (const expiryCase of [{
  name: "unparseable",
  access: {
    valid_until: "in 90 days"
  }
}, {
  name: "missing",
  access: undefined
}]) {
  for (const revocationStatus of [204, 503]) {
    test(`invalid session expiry preserves a recoverable credential until cleanup succeeds (${expiryCase.name}, ${revocationStatus})`, async context => {
      context.mock.method(console, "warn", () => {});
      const {
        db,
        actor,
        requests,
        useProvider
      } = await providerDatabase(context);

      await insertPendingAuthorization(db, actor, "invalid-expiry");
      useProvider(({ method }) => method === "DELETE" ? new Response(null, {
        status: revocationStatus
      }) : Response.json(session("invalid-expiry-session", "unused", {
        access: expiryCase.access
      })));

      await assert.rejects(authorize("invalid-expiry", actor), {
        status: 502,
        message: "Enable Banking returned an unexpected response."
      });
      assert.deepEqual(requests, ["POST /sessions", "DELETE /sessions/invalid-expiry-session"]);
      const stored = await connection(db, "invalid-expiry");

      assert.equal(stored?.status, "ERROR");
      assert.equal(stored?.valid_until, null);

      if (revocationStatus === 204) {
        assert.equal(stored?.session_cipher, null);
      } else {
        assert.equal(decrypt(String(stored?.session_cipher)), "invalid-expiry-session");
      }

      assert.equal((await db.select().from(schema.accounts)).length, 0);
    });
  }

}

test("a bank redirect or directory that does not match the provider contract is rejected before anything is stored", async context => {
  context.mock.method(console, "warn", () => {});
  const {
    db,
    actor,
    useProvider
  } = await providerDatabase(context);
  const directory = {
    aspsps: [{
      name: "Example institution",
      country: "AT",
      maximum_consent_validity: 86_400
    }]
  };

  useProvider(({ path }) => {
    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: [callback]
      });
    }

    if (path === "/aspsps") {
      return Response.json(directory);
    }

    return Response.json({
      url: "http://bank.example/authorize",
      authorization_id: "synthetic-authorization"
    });
  });

  await assert.rejects(connectBank({
    bank: "Example institution",
    country: "AT"
  }, actor), {
    status: 502
  });
  assert.equal((await db.select().from(schema.requisitions)).length, 0);

  useProvider(() => Response.json({
    aspsps: [{
      name: "Example institution",
      country: "Austria"
    }]
  }));
  await assert.rejects(availableBanks("AT"), {
    status: 502
  });
});

test("malformed balances or transactions fail the account's sync without writing its balance or bookings", async context => {
  context.mock.method(console, "warn", () => {});
  const {
    db,
    useProvider
  } = await providerDatabase(context);

  await insertLinkedConnection(db, "linked", "dated");
  await db.insert(schema.accounts).values({
    id: "partial",
    name: "Partial account",
    kind: "checking",
    provider: "enable_banking",
    provider_uid: "uid-partial",
    requisition_id: "linked"
  });
  useProvider(({ path }) => {
    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    if (path === "/accounts/uid-dated/balances") {
      return Response.json({
        balances: [{
          ...balances.balances[0],
          reference_date: "31.01.2026"
        }]
      });
    }

    if (path === "/accounts/uid-partial/balances") {
      return Response.json(balances);
    }

    // A truncated page: the booking lacks its amount.
    return Response.json({
      transactions: [{
        ...bookedTransaction,
        transaction_amount: undefined
      }],
      continuation_key: null
    });
  });

  const result = await syncAccounts();

  assert.equal(result.status, "FAILED");
  assert.deepEqual(result.failures.map(failure => failure.message), ["Enable Banking returned an unexpected response.", "Enable Banking returned an unexpected response."]);
  assert.ok(result.failures.every(failure => !failure.reconnect));
  assert.deepEqual((await db.select().from(schema.accounts)).map(account => [account.balance_minor, account.sync_error]), [[null, "Enable Banking returned an unexpected response."], [null, "Enable Banking returned an unexpected response."]]);
  assert.equal((await db.select().from(schema.transactions)).length, 0);
  assert.equal((await db.select().from(schema.balanceSnapshots)).length, 0);
});

test("provider expiries are stored in the persisted timestamp format and malformed optional details are dropped", async context => {
  const {
    db,
    actor,
    useProvider
  } = await providerDatabase(context);

  await insertPendingAuthorization(db, actor, "offset");
  useProvider(() => Response.json(session("offset-session", "hash-offset", {
    access: {
      valid_until: "2099-01-01T02:00:00.123456+02:00"
    }
  })));

  assert.deepEqual(await authorize("offset", actor), {
    accounts: 1
  });
  assert.equal((await connection(db, "offset"))?.valid_until, "2099-01-01T00:00:00.123Z");

  useProvider(({ path }) => {
    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    if (path.endsWith("/balances")) {
      return Response.json(balances);
    }

    return Response.json({
      transactions: [{
        ...bookedTransaction,
        creditor: {
          name: 42,
          postal_address: {
            country: "AT"
          }
        },
        merchant_category_code: "5411"
      }],
      continuation_key: null
    });
  });

  const result = await syncAccounts();
  const booking = await db.select().from(schema.transactions).get();

  assert.equal(result.status, "SUCCESS");
  assert.equal(booking?.counterparty, "");
  assert.deepEqual(JSON.parse(booking?.provider_payload ?? "{}").creditor, {
    postal_address: {
      country: "AT"
    }
  });
  assert.equal(JSON.parse(booking?.provider_payload ?? "{}").merchant_category_code, "5411");
});

test("reauthorizing a bank revokes the provider session of the connection it supersedes", async context => {
  const {
    db,
    actor,
    requests,
    useProvider
  } = await providerDatabase(context);

  await insertLinkedConnection(db, "previous", "kept");
  await insertPendingAuthorization(db, actor, "renewed");
  useProvider(({ method }) => method === "DELETE" ? new Response(null, {
    status: 204
  }) : Response.json(session("renewed-session", "hash-kept")));

  assert.deepEqual(await authorize("renewed", actor), {
    accounts: 1
  });
  assert.deepEqual(requests, ["POST /sessions", "DELETE /sessions/previous-session"]);
  assert.equal((await connection(db, "previous"))?.status, "SUPERSEDED");
  assert.equal((await connection(db, "previous"))?.session_cipher, null);
  assert.equal((await connection(db, "renewed"))?.status, "LINKED");
  assert.equal(decrypt(String((await connection(db, "renewed"))?.session_cipher)), "renewed-session");
});

test("reauthorization preserves an unrelated connection that was already empty", async context => {
  const {
    db,
    actor,
    requests,
    useProvider
  } = await providerDatabase(context);

  await insertPendingAuthorization(db, actor, "empty");
  useProvider(() => Response.json(session("empty-session", "unused", {
    accounts: []
  })));
  assert.deepEqual(await authorize("empty", actor), {
    accounts: 0
  });
  const emptyBefore = await connection(db, "empty");

  await insertLinkedConnection(db, "previous", "kept");
  await insertPendingAuthorization(db, actor, "renewed");
  useProvider(({ method }) => method === "DELETE" ? new Response(null, {
    status: 204
  }) : Response.json(session("renewed-session", "hash-kept")));

  assert.deepEqual(await authorize("renewed", actor), {
    accounts: 1
  });
  assert.deepEqual(requests, ["POST /sessions", "POST /sessions", "DELETE /sessions/previous-session"]);
  assert.deepEqual(await connection(db, "empty"), emptyBefore);
  assert.equal((await connection(db, "previous"))?.status, "SUPERSEDED");
  assert.equal((await connection(db, "previous"))?.session_cipher, null);
  assert.equal((await db.select().from(schema.accounts).where(eq(schema.accounts.id, "kept")).get())?.requisition_id, "renewed");
});

test("a failed superseded-session revocation keeps the new connection and waits for explicit removal", async context => {
  const warnings = context.mock.method(console, "warn", () => {});
  const {
    db,
    actor,
    requests,
    useProvider
  } = await providerDatabase(context);
  let revocationAvailable = false;

  await insertLinkedConnection(db, "previous", "kept");
  await insertPendingAuthorization(db, actor, "renewed");
  useProvider(({
    method,
    path
  }) => {
    if (method === "DELETE") {
      return revocationAvailable ? new Response(null, {
        status: 204
      }) : Response.json({
        error: "API_ERROR"
      }, {
        status: 503
      });
    }

    if (path === "/sessions") {
      return Response.json(session("renewed-session", "hash-kept"));
    }

    if (path === "/application") {
      return Response.json({
        environment: "SANDBOX",
        redirect_urls: []
      });
    }

    if (path.endsWith("/balances")) {
      return Response.json(balances);
    }

    return Response.json({
      transactions: [],
      continuation_key: null
    });
  });

  assert.deepEqual(await authorize("renewed", actor), {
    accounts: 1
  });
  assert.equal((await connection(db, "renewed"))?.status, "LINKED");
  assert.equal((await connection(db, "renewed"))?.error, null);
  assert.equal((await connection(db, "previous"))?.status, "SUPERSEDED");
  assert.equal(decrypt(String((await connection(db, "previous"))?.session_cipher)), "previous-session");
  assert.deepEqual(warnings.mock.calls.map(call => call.arguments[1]), [{
    reason: "API_ERROR"
  }]);

  revocationAvailable = true;

  assert.equal((await syncAccounts()).status, "SUCCESS");
  assert.deepEqual(requests.filter(request => request.startsWith("DELETE")), ["DELETE /sessions/previous-session"]);
  assert.notEqual((await connection(db, "previous"))?.session_cipher, null);
  assert.match(String((await connection(db, "previous"))?.error), /Remove this connection to retry/);

  await removeBankConnection("previous");
  assert.deepEqual(requests.filter(request => request.startsWith("DELETE")), ["DELETE /sessions/previous-session", "DELETE /sessions/previous-session"]);
  assert.equal((await connection(db, "previous"))?.session_cipher, null);
  assert.notEqual((await connection(db, "renewed"))?.session_cipher, null);
});

test("a session whose accounts cannot be mapped is revoked instead of staying active", async context => {
  context.mock.method(console, "warn", () => {});
  const {
    db,
    actor,
    requests,
    useProvider
  } = await providerDatabase(context);

  await insertPendingAuthorization(db, actor, "unmapped");
  useProvider(({ method }) => method === "DELETE" ? new Response(null, {
    status: 204
  }) : Response.json(session("unmapped-session", "hash-unmapped", {
    accounts: [{
      uid: "uid-unmapped",
      identification_hash: "hash-unmapped",
      currency: "XXX"
    }]
  })));

  await assert.rejects(authorize("unmapped", actor), {
    status: 502
  });
  assert.deepEqual(requests, ["POST /sessions", "DELETE /sessions/unmapped-session"]);
  assert.equal((await connection(db, "unmapped"))?.status, "ERROR");
  assert.equal((await connection(db, "unmapped"))?.session_cipher, null);
});

test("a cancelled bank callback consumes its state", async context => {
  const {
    db,
    actor,
    requests
  } = await providerDatabase(context);

  await insertPendingAuthorization(db, actor, "cancelled");
  await cancelAuthorization("state-cancelled", "wrong-browser", actor);
  assert.equal((await connection(db, "cancelled"))?.status, "PENDING");

  await cancelAuthorization("state-cancelled", "browser", actor);

  const cancelled = await connection(db, "cancelled");

  assert.equal(cancelled?.status, "ERROR");
  assert.notEqual(cancelled?.used_at, null);
  await assert.rejects(authorize("cancelled", actor), {
    status: 400
  });
  assert.deepEqual(requests, []);
});

test("a sync that receives a terminal session code expires the connection and deletes its session ID without a revocation", async context => {
  context.mock.method(console, "warn", () => {});
  const {
    db,
    requests,
    useProvider
  } = await providerDatabase(context);

  await insertLinkedConnection(db, "closed", "closed-account");
  useProvider(({ path }) => path === "/application" ? Response.json({
    environment: "SANDBOX",
    redirect_urls: []
  }) : Response.json({
    message: "Session is closed",
    code: 400,
    error: "CLOSED_SESSION"
  }, {
    status: 400
  }));

  const result = await syncAccounts();

  assert.deepEqual(result.failures.map(failure => failure.reconnect), [true]);
  assert.equal((await connection(db, "closed"))?.status, "EXPIRED");
  assert.equal((await connection(db, "closed"))?.session_cipher, null);
  assert.equal((await db.select().from(schema.accounts).get())?.requisition_id, "closed");
  assert.deepEqual(requests.filter(request => request.startsWith("DELETE")), []);
});

test("a connection past its consent expiry keeps its session for explicit removal instead of revoking in the background", async context => {
  const {
    db,
    requests,
    useProvider
  } = await providerDatabase(context);

  await insertLinkedConnection(db, "lapsed", "lapsed-account");
  await insertLinkedConnection(db, "unknown", "unknown-account");
  await db.update(schema.requisitions).set({
    valid_until: "2000-01-01T00:00:00.000Z"
  });
  useProvider(({
    method,
    path
  }) => {
    if (path === "/sessions/unknown-session") {
      return Response.json({
        message: "No session found matching provided id",
        code: 404,
        error: "SESSION_DOES_NOT_EXIST"
      }, {
        status: 404
      });
    }

    return method === "DELETE" ? new Response(null, {
      status: 204
    }) : Response.json({
      environment: "SANDBOX",
      redirect_urls: []
    });
  });

  const result = await syncAccounts();

  assert.deepEqual(result.failures.map(failure => failure.reconnect), [true, true]);
  assert.deepEqual(requests.filter(request => request.startsWith("DELETE")), []);

  for (const id of ["lapsed", "unknown"]) {
    assert.equal((await connection(db, id))?.status, "EXPIRED");
    assert.notEqual((await connection(db, id))?.session_cipher, null);
  }

  await syncAccounts();
  assert.equal(requests.filter(request => request.startsWith("DELETE")).length, 0);

  for (const id of ["lapsed", "unknown"]) {
    await removeBankConnection(id);
    assert.equal((await connection(db, id))?.session_cipher, null);
  }

  assert.equal(requests.filter(request => request.startsWith("DELETE")).length, 2);
});
