import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Account } from "../src/features/accounts/types";
import type { Connection } from "../src/features/banking/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
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
  const { AppStoreProvider } = await import("../src/client/app-store");
  const screen = render(withQueryClient(queryClient, createElement(AppStoreProvider, {
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


test("a failed revocation stays in the open removal dialog and the same action can be retried", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  let closes = 0;

  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { RemoveConnectionDialog } = await import("../src/features/banking/components/remove-connection-form");
  const screen = render(withQueryClient(queryClient, createElement(RemoveConnectionDialog, {
    selectedConnection: connection,
    close: () => {
      closes++;
    }
  })));
  const remove = () => screen.getByRole("button", {
    name: "Remove connection"
  });

  await wait(0);
  await respond(requests("accounts")[0], Response.json([linkedAccount]));
  fireEvent.click(remove());
  await wait(0);
  await respond(requests("banking/connections/synthetic-connection")[0], Response.json({
    title: "Bad Gateway",
    status: 502,
    detail: "The bank authorization could not be revoked. The connection has not been removed. Try again.",
    traceId: "synthetic-removal-trace"
  }, {
    status: 502
  }));
  await respond(requests("accounts")[1], Response.json([linkedAccount]));
  await wait(0);

  assert.equal(closes, 0);
  assert.ok(screen.getByRole("dialog", {
    name: "Remove connection"
  }));
  assert.match(screen.getByRole("alert").textContent ?? "", /has not been removed/);
  assert.match(screen.getByRole("alert").textContent ?? "", /synthetic-removal-trace/);
  assert.equal(remove().hasAttribute("disabled"), false);

  assert.equal(requests("banking/connections/synthetic-connection")[0].url.searchParams.get("accounts"), "keep");
  fireEvent.click(screen.getByRole("checkbox", {
    name: /Archive these accounts/
  }));
  fireEvent.click(remove());
  await wait(0);
  assert.equal(requests("banking/connections/synthetic-connection")[1].url.searchParams.get("accounts"), "archive");
  await respond(requests("banking/connections/synthetic-connection")[1], Response.json({
    retainedAccounts: 1
  }));
  await respond(requests("accounts")[2], Response.json([{
    ...linkedAccount,
    requisition_id: null
  }]));
  await wait(0);
  assert.equal(closes, 1);
});
