import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import type { Account } from "../src/features/accounts/types";
import { queryKeys } from "../src/client/query-keys";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const account: Account = {
  id: "bank/selected",
  name: "My bank account",
  provider_name: "Original bank label",
  institution: "Example bank",
  kind: "checking",
  currency: "EUR",
  balance_minor: 12000,
  balance_date: "2026-01-01",
  last_booking_date: null,
  reported_balance_minor: null,
  reported_balance_date: null,
  reported_difference_minor: null,
  provider: "enable_banking",
  requisition_id: "connection",
  last_synced_at: null,
  valid_until: null,
  sync_error: null,
  archived_at: null
};

test("renaming a bank account targets its encoded ID, keeps failures in the dialog and refreshes cached account and transaction labels", async context => {
  const environment = browser(context);

  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };

  const { EditAccountDialog } = await import("../src/features/accounts/components/edit-account-dialog");
  let closed = false;

  environment.queryClient.setQueryData(queryKeys.accounts(), [account]);
  environment.queryClient.setQueryData(queryKeys.transactions.all(), []);
  const screen = render(withQueryClient(environment.queryClient, createElement(EditAccountDialog, {
    account,
    close: () => {
      closed = true;
    }
  })));

  const dialog = within(screen.getByRole("dialog"));

  assert.ok(dialog.getByText("Name at the bank: Original bank label"));

  act(() => {
    fireEvent.change(dialog.getByRole("textbox", {
      name: "Account name"
    }), {
      target: {
        value: "Household"
      }
    });
    fireEvent.submit(dialog.getByRole("button", {
      name: "Save"
    }).closest("form")!);
  });
  await wait(0);
  const initial = environment.requests("accounts/bank%2Fselected")[0];

  assert.equal(initial.method, "PATCH");
  assert.deepEqual(initial.body, {
    name: "Household"
  });
  await respond(initial, Response.json({
    detail: "Name could not be saved.",
    status: 422
  }, {
    status: 422
  }));
  assert.ok(screen.getByRole("dialog"));
  assert.ok(dialog.getByText("Name could not be saved."));
  assert.equal((dialog.getByRole("textbox", {
    name: "Account name"
  }) as HTMLInputElement).value, "Household");
  act(() => fireEvent.submit(dialog.getByRole("button", {
    name: "Save"
  }).closest("form")!));
  await wait(0);
  await respond(environment.requests("accounts/bank%2Fselected")[1], Response.json({
    ok: true
  }));
  assert.equal(closed, true);
  assert.equal(environment.queryClient.getQueryState(queryKeys.accounts())?.isInvalidated, true);
  assert.equal(environment.queryClient.getQueryState(queryKeys.transactions.all())?.isInvalidated, true);
});
