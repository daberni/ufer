import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useTransactionCategorization } from "../src/features/transactions/use-transaction-categorization";
import type { State, Transaction } from "../src/features/dashboard/types";

type PendingRequest = ReturnType<typeof Promise.withResolvers<Response>> & {
  url: string;
  body: unknown;
};

function browser(context: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/"
  });
  const originalFetch = globalThis.fetch;
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  const originalProperties = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const pending: PendingRequest[] = [];

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

  globalThis.fetch = async (input, init) => {
    const request = Object.assign(Promise.withResolvers<Response>(), {
      url: String(input),
      body: JSON.parse(String(init?.body))
    });

    pending.push(request);

    return request.promise;
  };

  context.after(() => {
    cleanup();
    dom.window.close();
    globalThis.fetch = originalFetch;

    for (const [key, descriptor] of originalProperties) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  return pending;
}

const transaction: Transaction = {
  id: "synthetic-entry",
  booking_date: "2000-01-10",
  amount_minor: -1250,
  currency: "EUR",
  counterparty: "Example Market",
  description: "Synthetic purchase",
  account_name: "Synthetic account",
  category_id: "groceries",
  category_source: "rule"
};

function renderCategorization() {
  const refreshes: number[] = [];
  const errors: string[] = [];
  const load = async () => {
    refreshes.push(refreshes.length + 1);
  };
  const hook = renderHook(() => {
    const [state, setState] = useState<State | null>({
      transactions: [transaction]
    } as State);
    const categorization = useTransactionCategorization({
      load,
      setError: message => errors.push(String(message)),
      setState
    });

    return {
      state,
      categorization
    };
  });

  return {
    ...hook,
    refreshes,
    errors
  };
}

function assignment(categoryId: string | null) {
  return Response.json({
    id: transaction.id,
    category_id: categoryId,
    category_source: "manual"
  });
}

function storedTransaction(state: State | null) {
  return state?.transactions.find(item => item.id === transaction.id);
}

test("a category change shows at once and is replaced by the stored assignment", async context => {
  const pending = browser(context);
  const {
    result,
    refreshes
  } = renderCategorization();

  act(() => {
    result.current.categorization.changeCategory(transaction, "leisure");
  });

  assert.equal(result.current.categorization.categoryFor(storedTransaction(result.current.state)!), "leisure");
  assert.equal(result.current.categorization.statusFor(transaction)?.kind, "saving");
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].body, {
    category_id: "leisure"
  });

  await act(async () => pending[0].resolve(assignment("leisure")));

  const stored = storedTransaction(result.current.state)!;

  assert.equal(stored.category_id, "leisure");
  assert.equal(stored.category_source, "manual");
  assert.equal(result.current.categorization.categoryFor(stored), "leisure");
  assert.equal(result.current.categorization.statusFor(transaction)?.kind, "saved");
  assert.equal(refreshes.length, 1);
});

test("a failed change restores the stored category and reports the failure at the row", async context => {
  const pending = browser(context);
  const {
    result,
    refreshes,
    errors
  } = renderCategorization();

  act(() => {
    result.current.categorization.changeCategory(transaction, "leisure");
  });
  await act(async () => pending[0].resolve(Response.json({
    title: "Unprocessable Content",
    detail: "Category does not exist.",
    status: 422
  }, {
    status: 422
  })));

  const stored = storedTransaction(result.current.state)!;

  assert.equal(stored.category_id, "groceries");
  assert.equal(result.current.categorization.categoryFor(stored), "groceries");
  assert.deepEqual(result.current.categorization.statusFor(transaction), {
    kind: "failed",
    message: "Category does not exist."
  });
  assert.equal(refreshes.length, 0);
  assert.deepEqual(errors, []);
});

test("quick changes to one row are saved in order and end at the latest selection", async context => {
  const pending = browser(context);
  const {
    result,
    refreshes
  } = renderCategorization();

  act(() => {
    result.current.categorization.changeCategory(transaction, "leisure");
  });
  act(() => {
    result.current.categorization.changeCategory(transaction, "transport");
  });

  assert.equal(pending.length, 1);
  assert.equal(result.current.categorization.categoryFor(storedTransaction(result.current.state)!), "transport");

  await act(async () => pending[0].resolve(assignment("leisure")));

  assert.equal(result.current.categorization.categoryFor(storedTransaction(result.current.state)!), "transport");
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[1].body, {
    category_id: "transport"
  });

  await act(async () => pending[1].resolve(assignment("transport")));

  const stored = storedTransaction(result.current.state)!;

  assert.equal(stored.category_id, "transport");
  assert.equal(result.current.categorization.categoryFor(stored), "transport");
  assert.equal(result.current.categorization.statusFor(transaction)?.kind, "saved");
  assert.equal(refreshes.length, 1);
});

test("a failed later change keeps the category stored by an earlier change", async context => {
  const pending = browser(context);
  const {
    result,
    refreshes
  } = renderCategorization();

  act(() => {
    result.current.categorization.changeCategory(transaction, "leisure");
  });
  act(() => {
    result.current.categorization.changeCategory(transaction, null);
  });
  await act(async () => pending[0].resolve(assignment("leisure")));
  await act(async () => pending[1].resolve(Response.json({
    title: "Internal Server Error",
    detail: "Request failed.",
    status: 500
  }, {
    status: 500
  })));

  const stored = storedTransaction(result.current.state)!;

  assert.equal(stored.category_id, "leisure");
  assert.equal(stored.category_source, "manual");
  assert.equal(result.current.categorization.categoryFor(stored), "leisure");
  assert.equal(result.current.categorization.statusFor(transaction)?.kind, "failed");
  assert.equal(refreshes.length, 1);
});
