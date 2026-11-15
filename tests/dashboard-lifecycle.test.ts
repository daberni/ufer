import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useActionFeedback } from "../src/components/ui/use-action-feedback";
import { useDashboard } from "../src/features/dashboard/use-dashboard";
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

async function waitForDebounce() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
}

test("a delayed pre-logout response cannot reopen the dashboard or restore financial state", async context => {
  const pending = browser(context);
  const { result } = renderHook(() => useDashboardData());

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
  const { result } = renderHook(() => useDashboardData());

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
  const { result } = renderHook(() => useDashboardData());

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
  const rendered = renderHook(() => useDashboardData());

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

  assert.deepEqual(result.current.results, {
    netWorth: "ready",
    cashFlow: "loading",
    transactions: "loading"
  });

  await act(async () => pending[1].resolve(Response.json({
    currency: "EUR",
    transactionCount: 2
  })));

  assert.deepEqual(result.current.results, {
    netWorth: "ready",
    cashFlow: "ready",
    transactions: "ready"
  });
  assert.equal(result.current.state?.transactionCount, 2);
});

test("a transaction filter change marks only the transaction list as loading", async context => {
  const { result } = await loadInitialState(context);

  act(() => result.current.setSearch("rent"));
  await wait(300);

  assert.deepEqual(result.current.results, {
    netWorth: "ready",
    cashFlow: "ready",
    transactions: "loading"
  });
});

test("a fast response replaces the results without showing loading first", async context => {
  const {
    pending,
    result
  } = await loadInitialState(context);

  act(() => result.current.setCurrency("USD"));
  await waitForDebounce();

  assert.equal(result.current.results.netWorth, "ready");

  await act(async () => pending[1].resolve(Response.json({
    currency: "USD",
    transactionCount: 0
  })));
  await wait(100);

  assert.equal(result.current.results.netWorth, "ready");
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
  assert.equal(result.current.results.transactions, "ready");
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

  assert.equal(result.current.results.cashFlow, "loading");
  assert.equal(result.current.state?.transactionCount, 1);

  await act(async () => pending[2].resolve(Response.json({
    currency: "EUR",
    transactionCount: 7
  })));

  assert.equal(result.current.results.cashFlow, "ready");
  assert.equal(result.current.state?.transactionCount, 7);
  assert.equal(new URL(pending[2].url, "http://localhost").searchParams.get("period"), serializePeriod(second));
});

test("a failed request for changed filters ends loading and masks the outdated results until a retry succeeds", async context => {
  const {
    pending,
    result
  } = await loadInitialState(context);

  act(() => result.current.selectPeriod(previousMonth(result.current.period)));
  await wait(300);
  assert.equal(result.current.results.cashFlow, "loading");
  await act(async () => pending[1].resolve(Response.json({
    detail: "The database is not reachable."
  }, {
    status: 503
  })));

  assert.equal(result.current.loadError, "The database is not reachable.");
  assert.deepEqual(result.current.results, {
    netWorth: "ready",
    cashFlow: "unavailable",
    transactions: "unavailable"
  });

  let retry: Promise<void> | undefined;

  act(() => {
    retry = result.current.load();
  });
  assert.equal(result.current.results.cashFlow, "loading");
  await act(async () => {
    pending[2].resolve(Response.json({
      currency: "EUR",
      transactionCount: 3
    }));
    await retry;
  });

  assert.equal(result.current.loadError, "");
  assert.equal(result.current.results.cashFlow, "ready");
  assert.equal(result.current.state?.transactionCount, 3);
});

test("a failed load stays reported until a later load succeeds", async context => {
  const pending = browser(context);
  const { result } = renderHook(() => useDashboardData());

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

test("a bank callback result is shown on the connections view and cleared when the view changes", async context => {
  browser(context);
  window.scrollTo = () => {};

  window.history.replaceState(null, "", "/?banking=connected");
  const { result } = renderHook(() => useDashboard());

  assert.equal(result.current.view, "connections");
  assert.equal(result.current.feedback?.tone, "success");
  assert.equal(window.location.search, "");

  act(() => result.current.changeView("overview"));

  assert.equal(result.current.feedback, null);
});
