import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useDashboardData } from "../src/features/dashboard/use-dashboard-data";
import { monthPeriod, serializePeriod, type Period } from "../src/features/dashboard/period";

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
  const pending: (ReturnType<typeof Promise.withResolvers<Response>> & {
    url: string
  })[] = [];

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

  globalThis.fetch = async input => {
    const request = Object.assign(Promise.withResolvers<Response>(), {
      url: String(input)
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

const onError = () => {};

async function waitForDebounce() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
}

test("a delayed pre-logout response cannot reopen the dashboard or restore financial state", async context => {
  const pending = browser(context);
  const { result } = renderHook(() => useDashboardData(onError));

  await waitForDebounce();
  assert.equal(pending.length, 1);
  act(() => result.current.setLocked(true));
  await act(async () => pending[0].resolve(Response.json({
    currency: "EUR"
  })));

  assert.equal(result.current.locked, true);
  assert.equal(result.current.state, null);
});

test("an older mutation refresh cannot replace the response for newer filters", async context => {
  const pending = browser(context);
  const { result } = renderHook(() => useDashboardData(onError));

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json({
    currency: "EUR"
  })));
  let refresh: Promise<void> | undefined;

  act(() => {
    refresh = result.current.load();
  });
  act(() => result.current.setCurrency("USD"));
  await waitForDebounce();
  assert.equal(pending.length, 3);
  await act(async () => pending[2].resolve(Response.json({
    currency: "USD"
  })));
  await act(async () => {
    pending[1].resolve(Response.json({
      currency: "EUR"
    }));
    await refresh;
  });

  assert.equal(result.current.currency, "USD");
  assert.equal(result.current.state?.currency, "USD");
});

test("a mutation completed after a filter change refreshes the current filters and current data", async context => {
  const pending = browser(context);
  const { result } = renderHook(() => useDashboardData(onError));

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json({
    currency: "EUR"
  })));
  const refreshFromEarlierAction = result.current.load;

  act(() => result.current.setCurrency("USD"));
  await waitForDebounce();
  await act(async () => pending[1].resolve(Response.json({
    currency: "USD",
    transactionCount: 0
  })));
  let refresh: Promise<void> | undefined;

  act(() => {
    refresh = refreshFromEarlierAction();
  });
  await act(async () => {
    pending[2]?.resolve(Response.json({
      currency: "USD",
      transactionCount: 2
    }));
    await refresh;
  });

  assert.equal(result.current.state?.currency, "USD");
  assert.equal(pending.length, 3);
  assert.equal(new URL(pending[2].url, "http://localhost").searchParams.get("currency"), "USD");
  assert.equal(result.current.state?.transactionCount, 2);
});

async function wait(milliseconds: number) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
  });
}

async function loadInitialState(context: TestContext) {
  const pending = browser(context);
  const rendered = renderHook(() => useDashboardData(onError));

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json({
    currency: "EUR",
    transactionCount: 1
  })));

  return {
    pending,
    result: rendered.result
  };
}

function previousMonth(period: Period) {
  assert.equal(period.kind, "month");

  return monthPeriod(period.month.subtract({
    months: 1
  }));
}

test("a period change marks the period results as loading until the response for that period arrives", async context => {
  const {
    pending,
    result
  } = await loadInitialState(context);

  act(() => result.current.selectPeriod(previousMonth(result.current.period)));
  await wait(300);

  assert.deepEqual(result.current.loading, {
    netWorth: false,
    cashFlow: true,
    transactions: true
  });

  await act(async () => pending[1].resolve(Response.json({
    currency: "EUR",
    transactionCount: 2
  })));

  assert.deepEqual(result.current.loading, {
    netWorth: false,
    cashFlow: false,
    transactions: false
  });
  assert.equal(result.current.state?.transactionCount, 2);
});

test("a transaction filter change marks only the transaction list as loading", async context => {
  const { result } = await loadInitialState(context);

  act(() => result.current.setSearch("rent"));
  await wait(300);

  assert.deepEqual(result.current.loading, {
    netWorth: false,
    cashFlow: false,
    transactions: true
  });
});

test("a fast response replaces the results without showing loading first", async context => {
  const {
    pending,
    result
  } = await loadInitialState(context);

  act(() => result.current.setCurrency("USD"));
  await waitForDebounce();

  assert.equal(result.current.loading.netWorth, false);

  await act(async () => pending[1].resolve(Response.json({
    currency: "USD",
    transactionCount: 0
  })));
  await wait(100);

  assert.equal(result.current.loading.netWorth, false);
  assert.equal(result.current.state?.currency, "USD");
});

test("a background refresh with unchanged filters keeps the current results visible", async context => {
  const {
    pending,
    result
  } = await loadInitialState(context);

  act(() => {
    result.current.load();
  });
  await wait(300);

  assert.equal(pending.length, 2);
  assert.equal(result.current.loading.transactions, false);
  assert.equal(result.current.state?.transactionCount, 1);
});

test("after rapid period changes only the response for the latest period ends loading", async context => {
  const {
    pending,
    result
  } = await loadInitialState(context);
  const first = previousMonth(result.current.period);
  const second = previousMonth(first);

  act(() => result.current.selectPeriod(first));
  await waitForDebounce();
  act(() => result.current.selectPeriod(second));
  await wait(300);
  assert.equal(pending.length, 3);
  await act(async () => pending[1].resolve(Response.json({
    currency: "EUR",
    transactionCount: 5
  })));

  assert.equal(result.current.loading.cashFlow, true);
  assert.equal(result.current.state?.transactionCount, 1);

  await act(async () => pending[2].resolve(Response.json({
    currency: "EUR",
    transactionCount: 7
  })));

  assert.equal(result.current.loading.cashFlow, false);
  assert.equal(result.current.state?.transactionCount, 7);
  assert.equal(new URL(pending[2].url, "http://localhost").searchParams.get("period"), serializePeriod(second));
});
