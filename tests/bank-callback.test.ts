import assert from "node:assert/strict";
import { test } from "node:test";
import { callbackFailureMessage, callbackResultForError, parseCallbackResult } from "../src/features/banking/callback-result";
import { bankCallbackUrl } from "../src/features/banking/server/callback-url";
import { HttpError } from "../src/lib/errors";

test("callback feedback accepts only known result codes", () => {
  assert.equal(parseCallbackResult("connected"), "connected");
  assert.equal(parseCallbackResult("cancelled"), "cancelled");
  assert.equal(parseCallbackResult("Your session is locked, call 555-0100"), null);
  assert.equal(parseCallbackResult("toString"), null);
  assert.equal(parseCallbackResult("__proto__"), null);
  assert.equal(parseCallbackResult(null), null);
});

test("callback errors map to fixed codes without forwarding provider messages", () => {
  assert.equal(callbackResultForError(new HttpError(400, "Callback expired")), "expired");
  assert.equal(callbackResultForError(new HttpError(409, "Removed")), "removed");
  assert.equal(callbackResultForError(new HttpError(502, "Provider said: account 123 rejected")), "failed");
  assert.equal(callbackResultForError(new Error("boom")), "failed");
  assert.ok(callbackFailureMessage("failed").length > 0);
});

test("the provider callback uses the application origin unless overridden", () => {
  const saved = {
    APP_URL: process.env.APP_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    ENABLE_BANKING_REDIRECT_URL: process.env.ENABLE_BANKING_REDIRECT_URL
  };

  try {
    delete process.env.APP_URL;
    delete process.env.ENABLE_BANKING_REDIRECT_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_BRANCH_URL = "ufer-git-branch.vercel.app";
    process.env.VERCEL_URL = "ufer-abc123.vercel.app";
    assert.equal(bankCallbackUrl(), "https://ufer-git-branch.vercel.app/api/banking/callback");

    process.env.APP_URL = "https://ufer.example";
    assert.equal(bankCallbackUrl(), "https://ufer.example/api/banking/callback");

    process.env.ENABLE_BANKING_REDIRECT_URL = "http://localhost:3000/api/banking/callback";
    assert.equal(bankCallbackUrl(), "http://localhost:3000/api/banking/callback");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
