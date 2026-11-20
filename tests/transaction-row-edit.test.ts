import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import type { Transaction } from "../src/features/transactions/types";
import { browser, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const transfer: Transaction = {
  id: "transfer-row",
  booking_date: "2026-09-02",
  amount_minor: -35000,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: "Synthetic savings",
  description: "Standing order",
  source_counterparty: "Synthetic savings",
  source_description: "Standing order",
  hidden: false,
  account_name: "Synthetic checking",
  category_id: null,
  category_source: "rule",
  category_rule_id: null,
  automatic_assignment: null,
  split: null,
  type: "transfer",
  type_source: "auto",
  type_rule_id: null,
  account_id: "checking",
  manual_account: false,
  account_archived: false,
  counterpart_archived: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: {
    id: "other",
    account_name: "Synthetic savings",
    booking_date: "2026-09-02"
  }
};

test("editing a row opens its dialog and restores focus without turning category or description interactions into editing", async context => {
  const environment = browser(context);

  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { TransactionList } = await import("../src/features/transactions/components/transaction-list");
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const screen = render(withQueryClient(environment.queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: {
      current: null
    }
  }, createElement(TransactionList, {
    transactions: [transfer],
    categories: []
  }))));
  const row = screen.getAllByRole("row")[1];
  const edit = within(row).getByRole("button", {
    name: "Edit transaction: Synthetic savings"
  });

  fireEvent.click(within(row).getByText("Details", {
    selector: "summary"
  }));
  assert.equal(screen.queryByRole("dialog"), null);
  fireEvent.focus(within(row).getByRole("combobox"));
  assert.equal(screen.queryByRole("dialog"), null);

  edit.focus();
  fireEvent.click(edit);
  await wait(0);
  assert.ok(screen.getByRole("dialog", {
    name: "Edit transaction"
  }));
  fireEvent.click(screen.getByRole("button", {
    name: "Close dialog"
  }));
  await wait(0);
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, edit);
  assert.equal(screen.getAllByRole("columnheader").length, 5);
  assert.ok(within(row).getByRole("img", {
    name: "Transfer"
  }));
  assert.ok(within(row).getByText("to Synthetic savings"));
});

test("bookings on archived accounts show their payee without an edit action", async context => {
  const environment = browser(context);
  const { TransactionList } = await import("../src/features/transactions/components/transaction-list");
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const screen = render(withQueryClient(environment.queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: {
      current: null
    }
  }, createElement(TransactionList, {
    transactions: [{
      ...transfer,
      account_archived: true
    }],
    categories: []
  }))));
  const row = screen.getAllByRole("row")[1];

  assert.equal(within(row).queryByRole("button", {
    name: /Edit transaction/
  }), null);
  assert.ok(within(row).getAllByText("Synthetic savings").length > 0);
});

test("a booking linked to a counterpart on an archived account shows no edit action but keeps its category picker", async context => {
  const environment = browser(context);
  const { TransactionList } = await import("../src/features/transactions/components/transaction-list");
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const screen = render(withQueryClient(environment.queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: {
      current: null
    }
  }, createElement(TransactionList, {
    transactions: [{
      ...transfer,
      counterpart_archived: true
    }],
    categories: []
  }))));
  const row = screen.getAllByRole("row")[1];

  assert.equal(within(row).queryByRole("button", {
    name: /Edit transaction/
  }), null);
  assert.ok(within(row).getByRole("combobox"));
});
