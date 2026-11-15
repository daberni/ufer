import assert from "node:assert/strict";
import { test } from "node:test";
import { getIronSession } from "iron-session";
import { sessionOptions } from "../src/features/auth/server/session";

test("installation session cookies are host-bound under HTTPS and reject tampering and expiry", async context => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousUrl = process.env.APP_URL;

  context.after(() => {
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }

    if (previousUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousUrl;
    }
  });

  process.env.SESSION_SECRET = "synthetic-session-secret-for-session-tests";
  process.env.APP_URL = "https://finance.example";
  const response = new Response();
  const options = sessionOptions();
  const session = await getIronSession<{
    authenticated: boolean
  }>(new Request(process.env.APP_URL), response, options);

  session.authenticated = true;
  await session.save();
  const header = response.headers.get("set-cookie") || "";
  const cookie = header.split(";")[0];

  assert.ok(cookie.startsWith("__Host-session="));
  assert.match(header, /; Secure/i);
  assert.match(header, /; HttpOnly/i);
  assert.match(header, /; SameSite=Lax/i);
  assert.match(header, /; Path=\//i);
  assert.doesNotMatch(header, /; Domain=/i);
  const restored = await getIronSession<{
    authenticated: boolean
  }>(new Request(process.env.APP_URL, {
    headers: {
      cookie
    }
  }), new Response(), options);

  assert.equal(restored.authenticated, true);
  const index = Math.floor(cookie.length / 2);
  const altered = cookie.slice(0, index) + (cookie[index] === "a" ? "b" : "a") + cookie.slice(index + 1);
  const rejected = await getIronSession<{
    authenticated: boolean
  }>(new Request(process.env.APP_URL, {
    headers: {
      cookie: altered
    }
  }), new Response(), options);

  assert.equal(rejected.authenticated, undefined);
  context.mock.timers.enable({
    apis: ["Date"],
    now: Date.now()
  });
  context.mock.timers.tick(8 * 86_400_000);
  const expired = await getIronSession<{
    authenticated: boolean
  }>(new Request(process.env.APP_URL, {
    headers: {
      cookie
    }
  }), new Response(), options);

  assert.equal(expired.authenticated, undefined);
  context.mock.timers.reset();

  process.env.APP_URL = "http://localhost:3000";
  const localOptions = sessionOptions();

  assert.equal(localOptions.cookieName, "session");
  assert.equal(localOptions.cookieOptions?.secure, false);
});
