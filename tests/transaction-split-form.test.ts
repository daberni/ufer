import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Transaction } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const outgoing: Transaction = {
  id: "out",
  booking_date: "2026-09-02",
  amount_minor: -35000,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: "Example Market",
  description: "Synthetic purchase",
  source_counterparty: "Example Market",
  source_description: "Synthetic purchase",
  hidden: false,
  account_name: "Synthetic checking",
  account_id: "synthetic-checking",
  account_archived: false,
  category_id: null,
  category_source: "rule",
  category_rule_id: null,
  automatic_assignment: null,
  split: null,
  type: "expense",
  type_source: "auto",
  manual_account: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: null,
  counterpart_archived: false
};

async function renderDialog(context: TestContext, transaction: Transaction) {
  const browserEnvironment = browser(context);

  // jsdom has no modal dialogs.
  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const closed: boolean[] = [];
  const { TransactionEditDialog } = await import("../src/features/transactions/components/transaction-edit-dialog");
  const screen = render(withQueryClient(browserEnvironment.queryClient, createElement(TransactionEditDialog, {
    transaction,
    close: () => closed.push(true)
  })));

  await wait(0);

  return {
    ...browserEnvironment,
    screen,
    closed
  };
}

test("a split is entered in the booking's direction and can be saved only once its parts add up to the booking", async context => {
  const {
    requests,
    screen,
    closed
  } = await renderDialog(context, outgoing);

  fireEvent.click(screen.getByRole("button", {
    name: "Split into categories"
  }));

  const amounts = () => screen.getAllByRole("textbox", {
    name: /^Amount of part/
  }) as HTMLInputElement[];
  const saveSplit = () => screen.getByRole("button", {
    name: "Save split"
  }) as HTMLButtonElement;

  assert.deepEqual(amounts().map(input => input.value), ["350.00", ""]);
  assert.equal(saveSplit().disabled, true);

  fireEvent.change(amounts()[1], {
    target: {
      value: "100"
    }
  });
  assert.equal(saveSplit().disabled, true);
  assert.ok(screen.getByText("€100.00 too much"));

  fireEvent.change(amounts()[0], {
    target: {
      value: "240"
    }
  });
  fireEvent.click(screen.getByRole("button", {
    name: "Add part"
  }));
  assert.equal(amounts()[2].value, "10.00");
  assert.ok(screen.getByText("Balanced"));
  assert.equal(saveSplit().disabled, false);

  await act(async () => {
    fireEvent.click(saveSplit());
  });

  const request = requests("transactions/out/split")[0];

  assert.deepEqual(request?.body, {
    parts: [{
      amount: "-240.00",
      category_id: null,
      note: ""
    }, {
      amount: "-100.00",
      category_id: null,
      note: ""
    }, {
      amount: "-10.00",
      category_id: null,
      note: ""
    }]
  });
  await respond(request, Response.json({
    ok: true
  }));
  assert.deepEqual(closed, [true]);
});
