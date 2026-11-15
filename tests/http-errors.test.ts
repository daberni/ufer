import assert from "node:assert/strict";
import { test } from "node:test";
import { trace } from "@opentelemetry/api";
import { z } from "zod";
import { api } from "../src/client/api";
import { HttpError } from "../src/lib/errors";
import { minorUnits } from "../src/lib/money";
import { parseBalancesCsv } from "../src/lib/import";
import { normalizeTransactions, selectedBalance } from "../src/features/banking/server/bank-data";
import type { BankTransaction } from "../src/features/banking/server/enable-banking-client";
import { respond } from "../src/server/http/respond";

const request = new Request("http://localhost/api/example?private=not-for-logs");
const publicAccess = {
  access: "public"
} as const;

test("an invalid amount is user validation in CSV but a provider failure in bank data", async context => {
  context.mock.method(console, "warn", () => {});
  const csv = await respond(request, async () => parseBalancesCsv("date,balance,currency\n2020-01-01,0.005,EUR", "EUR"), publicAccess);
  const bank = await respond(request, async () => selectedBalance([{
    balance_type: "CLBD",
    balance_amount: {
      amount: "0.005",
      currency: "EUR"
    }
  }], "EUR"), publicAccess);
  const csvProblem = await csv.json();
  const bankProblem = await bank.json();

  assert.equal(csv.status, 422);
  assert.equal(csvProblem.detail, "The amount has too many decimal places.");
  assert.equal(bank.status, 502);
  assert.equal(bankProblem.status, 502);
  assert.match(bankProblem.detail, /bank/i);
  assert.equal(bankProblem.detail.includes("0.005"), false);
});

test("invalid provider transactions and missing balances never appear as user input failures", async context => {
  context.mock.method(console, "warn", () => {});
  const transaction: BankTransaction = {
    status: "BOOK",
    entry_reference: "synthetic-reference",
    booking_date: "2020-01-01",
    transaction_amount: {
      amount: "10.00",
      currency: "EUR"
    },
    credit_debit_indicator: "DBIT"
  };
  const invalidTransactions = [{
    ...transaction,
    entry_reference: undefined
  }, {
    ...transaction,
    booking_date: "invalid"
  }, {
    ...transaction,
    transaction_amount: {
      amount: "private-invalid-amount",
      currency: "EUR"
    }
  }, {
    ...transaction,
    transaction_amount: {
      amount: "10.00",
      currency: "XXX"
    }
  }, {
    ...transaction,
    transaction_amount: {
      amount: "-10.00",
      currency: "EUR"
    }
  }];
  const operations = invalidTransactions.map(entry => async () => normalizeTransactions([entry], new Set()));

  operations.push(async () => normalizeTransactions([transaction, {
    ...transaction,
    booking_date: "2020-01-02"
  }], new Set()));
  const responses = await Promise.all(operations.map(operation => respond(request, operation, publicAccess)));
  const missingBalance = await respond(request, async () => selectedBalance([], "EUR"), publicAccess);

  for (const response of [...responses, missingBalance]) {
    const problem = await response.json();

    assert.equal(response.status, 502);
    assert.equal(problem.status, 502);
    assert.equal(JSON.stringify(problem).includes("private-invalid-amount"), false);
  }
});

test("expected API failures use Problem Details with safe, unique occurrence and trace identifiers", async context => {
  const warnings = context.mock.method(console, "warn", () => {});
  const instances = new Set<string>();

  for (const status of [401, 403, 404, 409, 413, 422, 429, 503]) {
    const response = await respond(request, async () => {
      throw new HttpError(status, "A safe explanation.");
    }, publicAccess);
    const problem = await response.json();

    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") || "", /^application\/problem\+json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(problem.type, "about:blank");
    assert.equal(problem.status, status);
    assert.equal(typeof problem.title, "string");
    assert.equal(problem.detail, "A safe explanation.");
    assert.match(problem.instance, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.match(problem.traceId, /^[0-9a-f]{32}$/);
    assert.notEqual(problem.traceId, "0".repeat(32));
    assert.equal(response.headers.get("x-trace-id"), problem.traceId);
    assert.equal(JSON.stringify(problem).includes("not-for-logs"), false);
    instances.add(problem.instance);
    const diagnostic = warnings.mock.calls.at(-1)?.arguments[1];

    assert.equal(diagnostic?.traceId, problem.traceId);
    assert.equal(diagnostic?.instance, problem.instance);
    assert.equal(diagnostic?.status, status);
  }

  assert.equal(instances.size, 8);
});

test("JSON, schema and domain validation keep their status without exposing submitted values", async context => {
  context.mock.method(console, "warn", () => {});
  const invalidActions = [{
    status: 400,
    action: async () => JSON.parse("private malformed payload")
  }, {
    status: 400,
    action: async () => z.number().parse("private submitted value")
  }, {
    status: 422,
    action: async () => minorUnits("0.005")
  }];

  for (const invalid of invalidActions) {
    const response = await respond(request, invalid.action, publicAccess);
    const problem = await response.json();

    assert.equal(response.status, invalid.status);
    assert.equal(problem.status, invalid.status);
    assert.equal(typeof problem.detail, "string");
    assert.equal(JSON.stringify(problem).includes("private"), false);
  }
});

test("unexpected failures hide internals and correlate the response with sanitized diagnostics", async context => {
  const errors = context.mock.method(console, "error", () => {});
  const response = await respond(request, async () => {
    throw new Error("SELECT private financial payload", {
      cause: new Error("private credentials")
    });
  }, publicAccess);
  const problem = await response.json();
  const diagnostic = errors.mock.calls[0]?.arguments[1];

  assert.equal(response.status, 500);
  assert.equal(problem.title, "Internal Server Error");
  assert.equal(diagnostic?.traceId, problem.traceId);
  assert.equal(diagnostic?.instance, problem.instance);
  assert.equal(diagnostic?.status, 500);
  assert.equal(JSON.stringify([problem, errors.mock.calls]).includes("private"), false);
});

test("an existing valid OpenTelemetry span supplies the trace ID instead of an untrusted header", async context => {
  context.mock.method(console, "warn", () => {});
  const traceId = "a".repeat(32);
  const span = trace.wrapSpanContext({
    traceId,
    spanId: "b".repeat(16),
    traceFlags: 0
  });

  context.mock.method(trace, "getActiveSpan", () => span);
  const response = await respond(new Request(request, {
    headers: {
      "x-trace-id": "untrusted-client-value"
    }
  }), async () => {
    throw new HttpError(404, "Missing resource.");
  }, publicAccess);

  assert.equal((await response.json()).traceId, traceId);
  assert.equal(response.headers.get("x-trace-id"), traceId);
});

test("returned error responses cannot bypass Problem Details or expose an upstream payload", async context => {
  context.mock.method(console, "warn", () => {});
  const response = await respond(request, async () => new Response("private upstream body", {
    status: 502,
    headers: {
      "Retry-After": "60",
      "Content-Type": "text/plain",
      "Content-Length": "21"
    }
  }), publicAccess);
  const problem = await response.json();

  assert.equal(problem.status, 502);
  assert.equal(problem.title, "Bad Gateway");
  assert.equal(response.headers.get("retry-after"), "60");
  assert.match(response.headers.get("content-type") || "", /^application\/problem\+json/);
  assert.equal(response.headers.has("content-length"), false);
  assert.equal(JSON.stringify(problem).includes("private"), false);
});

test("foreign-origin failures use the same problem contract before executing the action", async context => {
  context.mock.method(console, "warn", () => {});
  let executed = false;
  const response = await respond(new Request(request, {
    method: "POST",
    headers: {
      origin: "https://other.invalid"
    }
  }), async () => {
    executed = true;
  }, publicAccess);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).status, 403);
  assert.equal(executed, false);
});

test("the browser transport preserves the problem explanation and diagnostic identity", async context => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    type: "about:blank",
    title: "Unprocessable Entity",
    status: 422,
    detail: "The amount has too many decimal places.",
    instance: "urn:uuid:example",
    traceId: "c".repeat(32)
  }, {
    status: 422,
    headers: {
      "Content-Type": "application/problem+json"
    }
  }));

  await assert.rejects(api("accounts", {}), {
    message: "The amount has too many decimal places.",
    status: 422,
    traceId: "c".repeat(32),
    instance: "urn:uuid:example"
  });
});
