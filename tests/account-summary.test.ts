import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { render, within } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { Temporal } from "temporal-polyfill";
import { AppStoreProvider } from "../src/client/app-store";
import { queryKeys } from "../src/client/query-keys";
import type { Account } from "../src/features/accounts/types";
import type { Connection } from "../src/features/banking/types";
import { browser, withQueryClient } from "./fixtures/browser";
import { menuItem, queryMenuItem } from "./fixtures/action-menu";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const router = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {}
} as unknown as AppRouterInstance;

const inOneYear = Temporal.Now.instant().add({
  hours: 24 * 365
}).toString();

const healthy: Account = {
  id: "checking",
  name: "Synthetic checking",
  provider_name: "Example provider account name",
  institution: "Example bank",
  kind: "checking",
  currency: "EUR",
  balance_minor: 95000,
  balance_date: "2026-11-20",
  last_booking_date: "2026-11-20",
  reported_balance_minor: 95000,
  reported_balance_date: "2026-11-20",
  reported_difference_minor: 0,
  provider: "enable_banking",
  requisition_id: "connection",
  last_synced_at: "2026-11-20T06:00:00.000Z",
  valid_until: inOneYear,
  sync_error: null,
  archived_at: null
};

const connection: Connection = {
  id: "connection",
  bank_name: "Example bank",
  bank_country: "AT",
  status: "LINKED",
  valid_until: inOneYear,
  error: null
};

async function renderSummary(context: TestContext, account: Account) {
  const environment = browser(context, "http://localhost/accounts/checking");

  Object.assign(globalThis, {
    self: window
  });
  context.after(() => {
    Reflect.deleteProperty(globalThis, "self");
  });
  const { AccountSummary } = await import("../src/features/accounts/components/account-summary");
  const { AccountMenu } = await import("../src/features/accounts/components/account-menu");

  environment.queryClient.setQueryData(queryKeys.banking.connections(), [connection]);
  const screen = render(withQueryClient(environment.queryClient, createElement(AppStoreProvider, {
    locked: false
  }, createElement(AppRouterContext, {
    value: router
  }, createElement(PathnameContext, {
    value: window.location.pathname
  }, createElement(SearchParamsContext, {
    value: new URLSearchParams()
  }, createElement(Fragment, null, createElement(AccountMenu, {
    account
  }), createElement(AccountSummary, {
    account,
    connections: [connection]
  }))))))));

  return screen;
}

// The page's live announcement regions are empty; the summary's notices carry text.
function noticeElements(screen: ReturnType<typeof render>) {
  return [...screen.queryAllByRole("alert"), ...screen.queryAllByRole("status")].filter(notice => notice.textContent !== "");
}

function notices(screen: ReturnType<typeof render>) {
  return noticeElements(screen).map(notice => notice.textContent);
}

test("a healthy bank account shows its institution, type, balance and one status line, with editing and reconnecting, not the connections list, in the menu", async context => {
  const screen = await renderSummary(context, healthy);
  const panel = within(screen.getByRole("region", {
    name: "Account summary"
  }));

  assert.equal(panel.queryByText("Synthetic checking"), null);
  assert.ok(panel.getByText("Example bank · Current account"));
  assert.ok(panel.getByText(/Synced/));
  assert.deepEqual(notices(screen), []);
  assert.equal(panel.queryByText(/Enable Banking/), null);
  assert.equal(panel.queryByRole("button", {
    name: /Reconnect/
  }), null);
  assert.ok(await menuItem(screen, "Edit account"));
  assert.ok(await menuItem(screen, "Reconnect Example bank"));
  assert.equal(await queryMenuItem(screen, "Manage bank connections"), null);
});

test("an expired authorization shows one notice whose one action reconnects, and hides a mismatch and the menu entry", async context => {
  const screen = await renderSummary(context, {
    ...healthy,
    valid_until: "2026-01-01T00:00:00.000Z",
    sync_error: "Bank authorization has expired. Reconnect the bank.",
    reported_difference_minor: -5000
  });
  const [notice, ...others] = noticeElements(screen);

  assert.equal(others.length, 0);
  assert.match(notice.textContent ?? "", /authorization expired/);
  assert.deepEqual(within(notice).getAllByRole("button").map(button => button.textContent), ["Reconnect bank"]);
  assert.equal(screen.queryByText(/Synced/), null);
  assert.equal(await queryMenuItem(screen, "Reconnect Example bank"), null);
});

test("a bank balance that differs from the bookings shows one notice whose one action books the adjustment", async context => {
  const screen = await renderSummary(context, {
    ...healthy,
    reported_balance_minor: 90000,
    reported_difference_minor: -5000
  });
  const [notice, ...others] = noticeElements(screen);

  assert.equal(others.length, 0);
  assert.match(notice.textContent ?? "", /bookings up to that day add up to/);
  assert.equal(within(notice).getAllByRole("button").length, 1);
  assert.match(within(notice).getByRole("button").textContent ?? "", /^Book .*50.* adjustment$/);
});

test("an archived account shows a one-line archive hint instead of a notice and offers restoring in the menu", async context => {
  const screen = await renderSummary(context, {
    ...healthy,
    reported_difference_minor: -5000,
    archived_at: "2026-11-01T00:00:00.000Z"
  });

  assert.deepEqual(notices(screen), []);
  assert.match(screen.getByText(/hidden from lists, still counted in reports/).textContent ?? "", /^Archived on .+ · hidden from lists, still counted in reports$/);
  assert.equal(screen.queryByText(/Synced/), null);
  assert.ok(await menuItem(screen, "Restore account"));
  assert.equal(await queryMenuItem(screen, "Reconnect Example bank"), null);
});
