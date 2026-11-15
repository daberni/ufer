import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createElement, type ReactNode } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { useActionFeedback } from "../src/components/ui/use-action-feedback";
import { useDashboard } from "../src/features/dashboard/use-dashboard";
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
  return renderHook(({ query }) => useDashboardData(query), {
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

test("a failed load stays reported until a later load succeeds", async context => {
  const pending = browser(context);
  const { result } = renderDashboardData();

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json({
    title: "Service unavailable",
    detail: "The database is not reachable."
  }, {
    status: 503
  })));

  assert.equal(result.current.loadError, "The database is not reachable.");

  let refresh: Promise<void> | undefined;

  act(() => {
    refresh = result.current.load();
  });
  await act(async () => {
    pending[1].resolve(Response.json({
      currency: "EUR"
    }));
    await refresh;
  });

  assert.equal(result.current.loadError, "");
  assert.equal(result.current.state?.currency, "EUR");
});

test("action feedback is dropped when its context changes", async context => {
  browser(context);
  const {
    result,
    rerender
  } = renderHook(({ view }) => useActionFeedback(view), {
    initialProps: {
      view: "rules"
    }
  });

  act(() => result.current.report({
    tone: "problem",
    messages: ["Rules could not be applied."]
  }));
  rerender({
    view: "rules"
  });
  assert.deepEqual(result.current.feedback?.messages, ["Rules could not be applied."]);

  rerender({
    view: "overview"
  });
  assert.equal(result.current.feedback, null);
});

test("success feedback dismisses itself while problems stay until dismissed", async context => {
  browser(context);
  context.mock.timers.enable({
    apis: ["setTimeout"]
  });
  const { result } = renderHook(() => useActionFeedback());

  act(() => result.current.report({
    tone: "problem",
    messages: ["Sync failed."]
  }));
  act(() => context.mock.timers.tick(60_000));
  assert.deepEqual(result.current.feedback?.messages, ["Sync failed."]);

  act(() => result.current.report({
    tone: "success",
    messages: ["Rules applied."]
  }));
  act(() => context.mock.timers.tick(8_000));
  assert.equal(result.current.feedback, null);
});

// Stands in for the App Router, which provides the current route to the dashboard layout; tests navigate with history.replaceState and rerender.
function renderDashboard(url: string) {
  window.history.replaceState(null, "", url);
  const replaced: string[] = [];
  const router = {
    push: () => {},
    replace: (href: string) => {
      replaced.push(href);
    },
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {}
  } as unknown as AppRouterInstance;

  function wrapper({ children }: {
    children: ReactNode
  }) {
    const route = createElement(PathnameContext, {
      value: window.location.pathname
    }, createElement(SearchParamsContext, {
      value: new URLSearchParams(window.location.search)
    }, children));

    return createElement(AppRouterContext, {
      value: router
    }, route);
  }

  return {
    ...renderHook(() => useDashboard(), {
      wrapper
    }),
    replaced
  };
}

function transactionListState(transactionCount: number, page: number) {
  return {
    currency: "EUR",
    page,
    transactionCount,
    accounts: [],
    transactions: [],
    categories: [],
    rules: [],
    connections: [],
    runs: [],
    breakdown: [],
    trend: []
  };
}

function requestedPage(request: {
  url: string
}) {
  return new URL(request.url, "http://localhost").searchParams.get("page");
}

test("a bank callback result is shown on the connections view and cleared when the view changes", async context => {
  browser(context);
  const {
    result,
    rerender,
    replaced
  } = renderDashboard("/connections?banking=connected");

  assert.equal(result.current.view, "connections");
  assert.equal(result.current.feedback?.tone, "success");
  assert.deepEqual(replaced, ["/connections"]);

  window.history.replaceState(null, "", "/");
  rerender();

  assert.equal(result.current.view, "overview");
  assert.equal(result.current.feedback, null);
});

test("a page past the last one is replaced by the last available page", async context => {
  const pending = browser(context);
  const {
    result,
    rerender
  } = renderDashboard("/transactions?page=10");

  await waitForDebounce();
  assert.equal(requestedPage(pending[0]), "10");
  await act(async () => pending[0].resolve(Response.json(transactionListState(60, 10))));

  assert.equal(result.current.page, 2);
  assert.equal(window.location.search, "?page=2");

  rerender();
  await waitForDebounce();
  assert.equal(pending.length, 2);
  assert.equal(requestedPage(pending[1]), "2");
});

test("an empty transaction history falls back to the first page", async context => {
  const pending = browser(context);
  const {
    result,
    rerender
  } = renderDashboard("/transactions?page=3");

  await waitForDebounce();
  await act(async () => pending[0].resolve(Response.json(transactionListState(0, 3))));

  assert.equal(result.current.page, 1);
  assert.equal(window.location.search, "");

  rerender();
  await waitForDebounce();
  assert.equal(requestedPage(pending[1]), "1");
  await act(async () => pending[1].resolve(Response.json(transactionListState(0, 1))));
  assert.equal(result.current.page, 1);
  assert.equal(pending.length, 2);
});
