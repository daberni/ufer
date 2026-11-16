import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Account, Connection } from "../src/features/dashboard/types";
import { browser, wait, withQueryClient, type PendingRequest } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const connection = {
  id: "synthetic-connection",
  bank_name: "Synthetic Testbank",
  bank_country: "AT"
} as Connection;

const linkedAccount = {
  id: "synthetic-bank-account",
  provider: "enable_banking",
  requisition_id: "synthetic-connection"
} as Account;

async function respond(request: PendingRequest | undefined, response: Response) {
  assert.ok(request, "expected a request");
  await act(async () => {
    request.resolve(response);
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}

test("removal stays disabled until the dialog knows how many linked accounts it keeps, and a failed load offers a retry", async context => {
  const {
    queryClient,
    requests
  } = browser(context);

  // jsdom has no modal dialogs.
  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { RemoveConnectionDialog } = await import("../src/features/banking/components/remove-connection-form");
  const { DashboardStoreProvider } = await import("../src/features/dashboard/dashboard-store");
  const screen = render(withQueryClient(queryClient, createElement(DashboardStoreProvider, {
    locked: false
  }, createElement(RemoveConnectionDialog, {
    selectedConnection: connection,
    close: () => {}
  }))));
  const remove = () => screen.getByRole("button", {
    name: "Remove connection"
  });

  await wait(0);
  assert.equal(remove().hasAttribute("disabled"), true);
  // Until the accounts arrive, the count is a skeleton hidden from assistive technology, which hears that it is loading instead.
  assert.ok(screen.getByText("Loading the linked accounts …"));
  assert.equal(screen.getByText("0 linked account(s) stay in Ufer").getAttribute("aria-hidden"), "true");

  await respond(requests("accounts")[0], Response.json({
    title: "Internal Server Error"
  }, {
    status: 500
  }));
  assert.equal(remove().hasAttribute("disabled"), true);
  assert.ok(screen.getByText("The linked accounts could not be loaded."));

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Retry"
    }));
  });
  await wait(0);
  await respond(requests("accounts")[1], Response.json([linkedAccount]));

  assert.ok(screen.getByText("1 linked account(s) stay in Ufer"));
  assert.equal(remove().hasAttribute("disabled"), false);
});
