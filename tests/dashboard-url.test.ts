import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { DashboardStoreProvider } from "../src/features/dashboard/dashboard-store";
import { useDashboardNavigation } from "../src/features/dashboard/use-dashboard-navigation";
import { selectPeriod, setAccountFilter, setSearch, useChangeView, useDashboardQuery, useViewHref } from "../src/features/dashboard/use-dashboard-url";
import { monthPeriod, serializePeriod } from "../src/features/dashboard/period";
import { browser } from "./fixtures/browser";

// Stands in for the App Router: tests change the URL through history and rerender, as Next.js does after pushState, replaceState or a link.
function renderUrlState(context: TestContext, url: string) {
  browser(context);
  window.history.replaceState(null, "", url);
  const pushed: string[] = [];
  const router = {
    push: (href: string) => {
      pushed.push(href);
    },
    replace: () => {},
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

    return createElement(DashboardStoreProvider, null, createElement(AppRouterContext, {
      value: router
    }, route));
  }

  const rendered = renderHook(() => {
    useDashboardNavigation();

    return {
      query: useDashboardQuery(),
      viewHref: useViewHref(),
      changeView: useChangeView()
    };
  }, {
    wrapper
  });

  return {
    ...rendered,
    pushed,
    navigate: (next: string) => {
      window.history.pushState(null, "", next);
      rendered.rerender();
    }
  };
}

test("a filter change adds a history entry and returns to the first page, while a search replaces its entry", context => {
  renderUrlState(context, "/transactions?period=2026-10&page=3");
  const entries = window.history.length;

  act(() => setAccountFilter("synthetic-account"));

  assert.equal(window.location.search, "?period=2026-10&account=synthetic-account");
  assert.equal(window.history.length, entries + 1);

  act(() => setSearch("rent"));
  act(() => setSearch("rent payment"));

  assert.equal(window.location.search, "?period=2026-10&account=synthetic-account&search=rent+payment");
  assert.equal(window.history.length, entries + 1);
});

test("views without a period keep linking to the period selected last", context => {
  const {
    result,
    navigate,
    pushed
  } = renderUrlState(context, "/transactions?period=2026-10&currency=USD&search=rent");

  assert.equal(serializePeriod(result.current.query.period), "2026-10");

  navigate("/accounts");

  assert.equal(serializePeriod(result.current.query.period), "2026-10");
  assert.equal(result.current.query.currency, "USD");
  assert.equal(result.current.query.search, "");
  assert.equal(result.current.viewHref("overview"), "/?period=2026-10&currency=USD");
  assert.equal(result.current.viewHref("rules"), "/rules");

  act(() => result.current.changeView("transactions"));
  assert.deepEqual(pushed, ["/transactions?period=2026-10&currency=USD"]);
});

test("a period selected on the overview replaces the remembered one", context => {
  const {
    result,
    navigate
  } = renderUrlState(context, "/?period=2026-10");

  act(() => selectPeriod(monthPeriod(Temporal.PlainYearMonth.from("2026-08"))));
  navigate(`${window.location.pathname}${window.location.search}`);
  navigate("/connections");

  assert.equal(result.current.viewHref("transactions"), "/transactions?period=2026-08");
});
