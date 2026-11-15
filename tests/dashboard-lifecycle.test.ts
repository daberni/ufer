import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useDashboardData } from "../src/features/dashboard/use-dashboard-data";
import { currentMonthPeriod } from "../src/features/dashboard/period";
import type { DashboardQuery } from "../src/features/dashboard/dashboard-location";

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

function dashboardQuery(currency: string): DashboardQuery {
  return {
    period: currentMonthPeriod(),
    currency,
    search: "",
    account: "",
    category: "",
    page: 1
  };
}

function renderDashboardData() {
  return renderHook(({ query }) => useDashboardData(query, onError), {
    initialProps: {
      query: dashboardQuery("EUR")
    }
  });
}

async function waitForDebounce() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
}

test("a delayed pre-logout response cannot reopen the dashboard or restore financial state", async context => {
  const pending = browser(context);
  const { result } = renderDashboardData();

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
  const {
    result,
    rerender
  } = renderDashboardData();

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json({
    currency: "EUR"
  })));
  let refresh: Promise<void> | undefined;

  act(() => {
    refresh = result.current.load();
  });
  rerender({
    query: dashboardQuery("USD")
  });
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

  assert.equal(result.current.state?.currency, "USD");
});

test("a mutation completed after a filter change refreshes the current filters and current data", async context => {
  const pending = browser(context);
  const {
    result,
    rerender
  } = renderDashboardData();

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json({
    currency: "EUR"
  })));
  const refreshFromEarlierAction = result.current.load;

  rerender({
    query: dashboardQuery("USD")
  });
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
