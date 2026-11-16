import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { createAuthClient } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";
import { initializeDatabase } from "../src/server/database/migrations";
import type { Database } from "../src/server/database/connection";
import * as schema from "../src/server/database/schema";
import { HttpError } from "../src/lib/errors";
import { createAuth } from "../src/features/auth/server/auth";
import { resetUserPassword } from "../src/features/auth/server/password-recovery";
import { provisionUser } from "../src/features/auth/server/provision-user";
import { requireAuth } from "../src/features/auth/server/session";
import { handleAuthentication } from "../src/features/auth/server/auth-handler";
import { respond } from "../src/server/http/respond";

const origin = "https://finance.example";
const password = "synthetic-test-password-123";
const owner = {
  username: "ExampleOwner",
  email: "owner@example.test",
  name: "Example owner",
  password,
  role: "owner"
};

async function isolatedAuth(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globalDb = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globalDb.budgetDb;
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  const previousUrl = process.env.APP_URL;

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globalDb.budgetDb = Promise.resolve(db);
  process.env.BETTER_AUTH_SECRET = "synthetic-auth-secret-with-at-least-32-characters";
  process.env.APP_URL = origin;
  context.mock.method(console, "warn", () => {});
  context.after(() => {
    globalDb.budgetDb = previousDatabase;

    if (previousSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = previousSecret;
    }

    if (previousUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousUrl;
    }

    client.close();
  });

  return db;
}

function request(path: string, body?: unknown, cookie = "", additionalHeaders: HeadersInit = {}) {
  const headers = new Headers(additionalHeaders);

  headers.set("origin", origin);
  headers.set("content-type", "application/json");
  headers.set("cookie", cookie);

  return new Request(`${origin}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    })
  });
}

async function signIn(username = owner.username) {
  const response = await handleAuthentication(request("/sign-in/username", {
    username,
    password
  }));
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("__Secure-better-auth.session_token="))?.split(";")[0];

  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.ok(cookie);

  return {
    response,
    cookie
  };
}

test("enrollment creates an owner and hashed credentials atomically, while public signup stays closed", async context => {
  const db = await isolatedAuth(context);

  await assert.rejects(provisionUser({
    ...owner,
    role: "member"
  }), {
    status: 409
  });
  const created = await provisionUser(owner);
  const stored = await db.select().from(schema.authUsers).get();
  const credential = await db.select().from(schema.authAccounts).get();

  assert.equal(stored?.username, "exampleowner");
  assert.notEqual(credential?.password, password);
  assert.equal((await db.select().from(schema.memberships).get())?.userId, created.id);
  assert.equal((await handleAuthentication(request("/sign-up/email", owner))).status, 404);
  await assert.rejects(createAuth(db).api.signUpEmail({
    body: {
      ...owner,
      email: "visitor@example.test"
    }
  }));
  await assert.rejects(provisionUser({
    ...owner,
    username: "second-owner",
    email: "another@example.test"
  }));
  await assert.rejects(provisionUser({
    ...owner,
    role: "member",
    username: "EXAMPLEOWNER",
    email: "duplicate@example.test"
  }));
  await assert.rejects(provisionUser({
    ...owner,
    role: "member",
    username: "duplicateemail"
  }));
  assert.equal((await db.select().from(schema.authUsers)).length, 1);
  await assert.rejects(db.insert(schema.workspaces).values({
    id: "another-customer",
    name: "Another customer"
  }));
});

test("concurrent owner provisioning cannot create a second owner or orphan identity", async context => {
  const db = await isolatedAuth(context);
  const outcomes = await Promise.allSettled([
    provisionUser(owner),
    provisionUser({
      ...owner,
      username: "secondowner",
      email: "second@example.test"
    })
  ]);

  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await db.select().from(schema.authUsers)).length, 1);
  assert.equal((await db.select().from(schema.memberships)).length, 1);
});

test("financial access rejects anonymous, tampered, expired and revoked sessions", async context => {
  const db = await isolatedAuth(context);

  await provisionUser(owner);
  await assert.rejects(requireAuth(new Request(`${origin}/api/accounts`)), {
    status: 401
  });
  const {
    response,
    cookie
  } = await signIn("EXAMPLEOWNER");
  const header = response.headers.getSetCookie().find(value => value.startsWith(cookie));

  assert.match(header || "", /; Secure/i);
  assert.match(header || "", /; HttpOnly/i);
  assert.match(header || "", /; SameSite=Lax/i);
  assert.match(header || "", /; Path=\//i);
  assert.doesNotMatch(header || "", /; Domain=/i);
  const signed = new Request(`${origin}/api/accounts`, {
    headers: {
      cookie
    }
  });
  const actor = await requireAuth(signed);

  assert.equal(actor.username, "exampleowner");
  await assert.rejects(requireAuth(new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: cookie + "tampered"
    }
  })), {
    status: 401
  });
  await db.update(schema.authSessions).set({
    expiresAt: new Date(0)
  }).where(eq(schema.authSessions.id, actor.sessionId));
  await assert.rejects(requireAuth(signed), {
    status: 401
  });
  const second = await signIn();
  const secondRequest = new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: second.cookie
    }
  });

  assert.equal((await handleAuthentication(request("/sign-out", {}, second.cookie))).status, 200);
  await assert.rejects(requireAuth(secondRequest), {
    status: 401
  });
});

test("valid identities without active membership cannot access financial data", async context => {
  const db = await isolatedAuth(context);

  await provisionUser(owner);
  await createAuth(db, {
    enrollment: true
  }).api.signUpEmail({
    body: {
      ...owner,
      username: "outsider",
      email: "outsider@example.test"
    }
  });
  const outsider = await signIn("outsider");
  let reached = false;
  const blocked = await respond(new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: outsider.cookie
    }
  }), async () => {
    reached = true;

    return {
      private: "financial data"
    };
  });

  assert.equal(blocked.status, 403);
  assert.equal(reached, false);
  assert.equal((await blocked.json()).status, 403);
  const signed = await signIn();
  const authorized = new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: signed.cookie
    }
  });
  const actor = await requireAuth(authorized);

  await db.update(schema.memberships).set({
    active: false
  }).where(eq(schema.memberships.userId, actor.userId));
  await assert.rejects(requireAuth(authorized), {
    status: 403
  });
});

test("password changes revoke other sessions and the old password stops working", async context => {
  await isolatedAuth(context);
  await provisionUser(owner);
  const first = await signIn();
  const second = await signIn();
  const changed = await handleAuthentication(request("/change-password", {
    currentPassword: password,
    newPassword: "changed-synthetic-password-456",
    revokeOtherSessions: true
  }, second.cookie));

  assert.equal(changed.status, 200, JSON.stringify(await changed.clone().json()));
  await assert.rejects(requireAuth(new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: first.cookie
    }
  })), {
    status: 401
  });
  assert.equal((await handleAuthentication(request("/sign-in/username", {
    username: owner.username,
    password
  }))).status, 401);
  assert.equal((await handleAuthentication(request("/sign-in/username", {
    username: owner.username,
    password: "changed-synthetic-password-456"
  }))).status, 200);
});

test("the maintained client receives Problem Details errors without losing its error message", async context => {
  await isolatedAuth(context);
  await provisionUser(owner);
  const client = createAuthClient({
    baseURL: origin,
    plugins: [usernameClient()],
    fetchOptions: {
      customFetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);

        headers.set("origin", origin);

        return handleAuthentication(new Request(String(url), {
          ...init,
          headers
        }));
      }
    }
  });
  const result = await client.signIn.username({
    username: owner.username,
    password: "wrong-password"
  });

  assert.equal(result.error?.status, 401);
  assert.ok(result.error?.message);
  const rejected = await handleAuthentication(request("/sign-in/username", {
    username: owner.username,
    password: "wrong-password"
  }));
  const problem = await rejected.json();

  assert.equal(rejected.headers.get("content-type"), "application/problem+json");
  assert.equal(problem.message, problem.detail);
  assert.equal(problem.traceId, rejected.headers.get("x-trace-id"));
  const wrongOrigin = request("/sign-in/username", {
    username: owner.username,
    password
  });

  wrongOrigin.headers.set("origin", "https://untrusted.example");
  assert.equal((await handleAuthentication(wrongOrigin)).status, 403);
});

function trustClientAddressHeader(context: TestContext, header: string | undefined) {
  const previous = process.env.TRUSTED_CLIENT_IP_HEADER;

  if (header === undefined) {
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
  } else {
    process.env.TRUSTED_CLIENT_IP_HEADER = header;
  }

  context.after(() => {
    if (previous === undefined) {
      delete process.env.TRUSTED_CLIENT_IP_HEADER;
    } else {
      process.env.TRUSTED_CLIENT_IP_HEADER = previous;
    }
  });
}

function signInFrom(headers: HeadersInit, attemptPassword = password) {
  return handleAuthentication(request("/sign-in/username", {
    username: owner.username,
    password: attemptPassword
  }, "", headers));
}

test("without a trusted client address, throttling persists across auth instances and forwarded headers cannot bypass it", async context => {
  const db = await isolatedAuth(context);

  trustClientAddressHeader(context, undefined);
  await provisionUser(owner);

  for (let index = 0; index < 10; index++) {
    const auth = createAuth(db);
    const response = await auth.handler(request("/sign-in/username", {
      username: owner.username,
      password: "wrong-password"
    }, "", {
      "x-forwarded-for": `198.51.100.${index}`,
      "x-real-ip": `198.51.100.${index}`
    }));

    assert.equal(response.status, 401);
  }

  const limited = await signInFrom({
    "x-forwarded-for": "203.0.113.1"
  });

  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("x-retry-after"));
  assert.ok((await db.select().from(schema.authRateLimits)).length > 0);
});

test("with a trusted client address header, one client exceeding the sign-in limit does not block another and other headers do not reset its counter", async context => {
  await isolatedAuth(context);

  trustClientAddressHeader(context, "X-Forwarded-For");
  await provisionUser(owner);

  for (let index = 0; index < 10; index++) {
    const response = await signInFrom({
      "x-forwarded-for": "198.51.100.7",
      "x-real-ip": `192.0.2.${index}`
    }, "wrong-password");

    assert.equal(response.status, 401);
  }

  const limited = await signInFrom({
    "x-forwarded-for": "198.51.100.7",
    "x-real-ip": "192.0.2.200"
  });

  assert.equal(limited.status, 429);

  const otherClient = await signInFrom({
    "x-forwarded-for": "203.0.113.9"
  });

  assert.equal(otherClient.status, 200);

  for (let index = 1; index <= 10; index++) {
    const response = await signInFrom({
      "x-forwarded-for": `2001:db8:1:2::${index}`
    }, "wrong-password");

    assert.equal(response.status, 401);
  }

  const sameIpv6Network = await signInFrom({
    "x-forwarded-for": "2001:db8:1:2:ffff::1"
  });

  assert.equal(sameIpv6Network.status, 429);
});

test("an invalid trusted client address header name is a configuration error, not a failure on every request", async context => {
  const db = await isolatedAuth(context);

  trustClientAddressHeader(context, undefined);

  for (const header of ["X-Real-IP:", "x-forwarded-for, x-real-ip"]) {
    process.env.TRUSTED_CLIENT_IP_HEADER = header;
    assert.throws(() => createAuth(db), (error: unknown) => error instanceof HttpError && error.status === 503);
  }
});

test("operator password recovery uses library reset tokens and revokes all sessions without opening public recovery", async context => {
  const db = await isolatedAuth(context);

  await provisionUser(owner);
  const signed = await signIn();

  await assert.rejects(resetUserPassword({
    email: "missing@example.test",
    password: "replacement-test-password-123"
  }));
  assert.equal((await requireAuth(new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: signed.cookie
    }
  }))).username, "exampleowner");
  await resetUserPassword({
    email: owner.email,
    password: "replacement-test-password-123"
  });
  await assert.rejects(requireAuth(new Request(`${origin}/api/accounts`, {
    headers: {
      cookie: signed.cookie
    }
  })), {
    status: 401
  });
  assert.equal((await db.select().from(schema.authSessions)).length, 0);
  assert.equal((await handleAuthentication(request("/sign-in/username", {
    username: owner.username,
    password
  }))).status, 401);
  assert.equal((await handleAuthentication(request("/sign-in/username", {
    username: owner.username,
    password: "replacement-test-password-123"
  }))).status, 200);
  assert.equal((await handleAuthentication(request("/request-password-reset", {
    email: owner.email
  }))).status, 404);
  assert.equal((await handleAuthentication(request("/reset-password", {
    token: "untrusted",
    newPassword: password
  }))).status, 404);
});
