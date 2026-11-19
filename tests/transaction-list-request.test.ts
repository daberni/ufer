import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { apiQuery } from "../src/client/api";
import { ValidationError } from "../src/lib/errors";
import { serializePeriod } from "../src/lib/period";
import { transactionListRequest } from "../src/features/transactions/server/transaction-list-request";

function captureFetch(t: TestContext) {
  const requests: {
    url: string;
    init: RequestInit;
  }[] = [];

  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({
      url,
      init
    });

    return Response.json({
      transactions: []
    });
  });

  return requests;
}

test("the transaction list sends its filters in the body, never in the URL", async (t) => {
  const requests = captureFetch(t);

  await apiQuery("transactions/query", {
    search: "Private Payee",
    account: "acc-1",
    page: 2
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/transactions/query");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    search: "Private Payee",
    account: "acc-1",
    page: 2
  });
});

test("the transaction query body yields the same filters as the page address", () => {
  const filters = transactionListRequest({
    period: "2026-03",
    currency: "USD",
    search: "  rent ",
    account: "acc-1",
    category: "cat-1",
    type: "expense",
    syncRun: "run-1",
    page: 3
  });

  assert.equal(serializePeriod(filters.period), "2026-03");
  assert.equal(filters.currency, "USD");
  assert.equal(filters.search, "  rent ");
  assert.equal(filters.accountId, "acc-1");
  assert.equal(filters.categoryId, "cat-1");
  assert.equal(filters.type, "expense");
  assert.equal(filters.syncRunId, "run-1");
  assert.equal(filters.page, 3);
  assert.equal(transactionListRequest({}).page, 1);
});

test("the transaction query rejects malformed bodies as validation errors", () => {
  assert.throws(() => transactionListRequest(null), ValidationError);
  assert.throws(() => transactionListRequest(["search"]), ValidationError);
  assert.throws(() => transactionListRequest({
    search: 42
  }), ValidationError);
  assert.throws(() => transactionListRequest({
    page: "2"
  }), ValidationError);
});
