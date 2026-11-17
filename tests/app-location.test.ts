import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { viewQuery, periodScope, viewHref, withQueryChanges } from "../src/client/app-location";
import { allMonthsPeriod, currentMonth, monthPeriod, serializePeriod } from "../src/lib/period";
import { dashboardFilters } from "../src/server/http/dashboard-filters";
import { commitDelay, useSearchDraft } from "../src/features/transactions/use-search-draft";

test("a filter change resets pagination and leaves default values out of the URL", () => {
  const current = monthPeriod(currentMonth());

  assert.equal(withQueryChanges("/transactions", "?period=2026-10&page=3&search=rent", {
    period: current,
    page: 1
  }), "/transactions?search=rent");
  assert.equal(withQueryChanges("/transactions", "?page=3", {
    account: "acc-1",
    page: 1
  }), "/transactions?account=acc-1");
  assert.equal(withQueryChanges("/", "", {
    period: allMonthsPeriod
  }), "/?period=all");
  assert.equal(withQueryChanges("/", "?currency=USD", {
    currency: "EUR"
  }), "/");
});

test("the transaction list filters apply only to the transactions view", () => {
  const params = new URLSearchParams("period=2026-10&currency=USD&search=rent&account=acc-1&category=home&syncRun=run-1&page=2");
  const scope = periodScope(params);
  const overview = viewQuery("overview", scope, params);
  const transactions = viewQuery("transactions", scope, params);

  assert.equal(scope, "period=2026-10&currency=USD");
  assert.equal(serializePeriod(overview.period), "2026-10");
  assert.equal(overview.currency, "USD");
  assert.deepEqual([overview.search, overview.account, overview.category, overview.syncRun, overview.page], ["", "", "", "", 1]);
  assert.deepEqual([transactions.search, transactions.account, transactions.category, transactions.syncRun, transactions.page], ["rent", "acc-1", "home", "run-1", 2]);
  assert.equal(withQueryChanges("/transactions", "?period=2026-10&syncRun=run-1&page=2", {
    syncRun: "",
    page: 1
  }), "/transactions?period=2026-10");
});

test("views without a period link back to the period the user selected", () => {
  assert.equal(viewHref("overview", "period=2026-10"), "/?period=2026-10");
  assert.equal(viewHref("transactions", "period=all"), "/transactions?period=all");
  assert.equal(viewHref("accounts", "period=2026-10"), "/accounts");
});

test("a page in a link is a positive integer within the range the API serves", () => {
  const pageFor = (value: string) => {
    const params = new URLSearchParams({
      page: value
    });

    return viewQuery("transactions", "", params).page;
  };

  for (const invalid of ["Infinity", "-Infinity", "NaN", "abc", "2.5", "0", "-3", ""]) {
    assert.equal(pageFor(invalid), 1, invalid);
  }

  assert.equal(pageFor("7"), 7);
  assert.equal(pageFor("10001"), 10_000);
  assert.equal(pageFor("1e9"), 10_000);
  assert.equal(dashboardFilters(new URLSearchParams("page=10001")).page, 10_000);
  assert.equal(dashboardFilters(new URLSearchParams("page=Infinity")).page, 1);
});

test("an invalid period in a link falls back to the current month", () => {
  const params = new URLSearchParams("period=2026-13&page=0");
  const query = viewQuery("transactions", periodScope(params), params);

  assert.ok(query.period.kind === "month" && query.period.month.equals(currentMonth()));
  assert.equal(query.page, 1);
});

function browser(context: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/"
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  const originalProperties = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

  // Typing pauses are measured on the mocked clock, so a busy machine cannot commit early or late.
  context.mock.timers.enable({
    apis: ["setTimeout"]
  });

  context.after(() => {
    cleanup();
    dom.window.close();

    for (const [key, descriptor] of originalProperties) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}

function waitForCommit(context: TestContext) {
  act(() => context.mock.timers.tick(commitDelay));
}

function renderSearchDraft(commits: string[]) {
  const commit = (next: string) => {
    commits.push(next);
  };

  return renderHook(({ value }) => useSearchDraft(value, commit), {
    initialProps: {
      value: ""
    }
  });
}

test("typing after a search commit is kept while the URL catches up", async context => {
  browser(context);
  const commits: string[] = [];
  const {
    result,
    rerender
  } = renderSearchDraft(commits);

  act(() => result.current[1]("gro"));
  waitForCommit(context);
  assert.deepEqual(commits, ["gro"]);

  // The URL update for "gro" arrives asynchronously, after the user has typed more.
  act(() => result.current[1]("grocer"));
  rerender({
    value: "gro"
  });

  assert.equal(result.current[0], "grocer");
  waitForCommit(context);
  assert.deepEqual(commits, ["gro", "grocer"]);
});

test("Back or Forward to another search replaces the field and its unsent draft", async context => {
  browser(context);
  const commits: string[] = [];
  const {
    result,
    rerender
  } = renderSearchDraft(commits);

  act(() => result.current[1]("coffee"));
  waitForCommit(context);
  rerender({
    value: "coffee"
  });
  act(() => result.current[1]("coffee sh"));
  rerender({
    value: "rent"
  });

  assert.equal(result.current[0], "rent");
  waitForCommit(context);
  assert.deepEqual(commits, ["coffee"]);
});

test("a currency filter is normalized to uppercase and ignored on both sides unless the runtime knows the code", () => {
  const serverCurrency = (value: string) => dashboardFilters(new URLSearchParams({
    currency: value
  })).currency;
  const clientCurrency = (value: string) => {
    const params = new URLSearchParams({
      currency: value
    });

    return viewQuery("overview", periodScope(params), params).currency;
  };

  assert.equal(dashboardFilters(new URLSearchParams()).currency, "EUR");

  for (const read of [serverCurrency, clientCurrency]) {
    assert.equal(read("USD"), "USD");
    assert.equal(read("usd"), "USD");

    for (const ignored of ["XYZ", "E", "EURO", "E1R", ""]) {
      assert.equal(read(ignored), "EUR", ignored);
    }
  }
});
