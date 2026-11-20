import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import type { Account } from "../src/features/accounts/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const first: Account = {
  id: "cash",
  name: "Synthetic cash",
  provider_name: null,
  institution: "Example institution",
  kind: "checking",
  currency: "EUR",
  balance_minor: 10000,
  balance_date: "2026-09-01",
  provider: "manual",
  requisition_id: null,
  last_synced_at: null,
  valid_until: null,
  sync_error: null,
  archived_at: null
};

const selected: Account = {
  ...first,
  id: "savings",
  name: "Synthetic savings"
};

async function renderActions(context: TestContext) {
  const environment = browser(context);

  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { AccountDetailActions } = await import("../src/features/accounts/components/account-detail-actions");
  const actions = (account: Account) => withQueryClient(environment.queryClient, createElement(AccountDetailActions, {
    key: account.id,
    account,
    manualAccounts: [first, selected]
  }));
  const screen = render(actions(selected));

  return {
    ...environment,
    screen,
    actions
  };
}

test("account-detail actions submit entries to the selected account instead of the first manual account, and leave balance updates to the balance", async context => {
  const {
    screen,
    requests
  } = await renderActions(context);

  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Add transaction"
  })));
  const entryDialog = within(screen.getByRole("dialog"));

  assert.ok(entryDialog.getByText("Synthetic savings · EUR"));
  act(() => {
    fireEvent.change(entryDialog.getByRole("textbox", {
      name: "Amount"
    }), {
      target: {
        value: "-12.50"
      }
    });
    fireEvent.submit(entryDialog.getByRole("button", {
      name: "Add transaction"
    }).closest("form")!);
  });
  await wait(0);
  assert.equal(requests("accounts/savings/transactions").length, 1);
  assert.equal(requests("accounts/cash/transactions").length, 0);
  await respond(requests("accounts/savings/transactions")[0], Response.json({
    id: "entered"
  }));
  assert.equal(screen.queryByRole("dialog"), null);

  assert.equal(screen.queryByRole("button", {
    name: "Update balance"
  }), null);
});

test("switching the account closes its open dialog and the next entry uses the new account", async context => {
  const {
    screen,
    actions,
    requests
  } = await renderActions(context);

  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Add transaction"
  })));
  assert.ok(screen.getByRole("dialog"));
  screen.rerender(actions(first));
  assert.equal(screen.queryByRole("dialog"), null);

  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Add transaction"
  })));
  const dialog = within(screen.getByRole("dialog"));

  assert.ok(dialog.getByText("Synthetic cash · EUR"));
  act(() => fireEvent.submit(dialog.getByRole("button", {
    name: "Add transaction"
  }).closest("form")!));
  await wait(0);
  assert.equal(requests("accounts/cash/transactions").length, 1);
  assert.equal(requests("accounts/savings/transactions").length, 0);
});
