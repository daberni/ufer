import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fireEvent, render, within } from "@testing-library/react";
import { createElement } from "react";
import type { Transaction } from "../src/features/transactions/types";
import { browser, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const fullPayee = "Synthetic merchant with a long counterparty reference ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const fullDescription = "Card purchase from a synthetic merchant\nReference AT000000000000000000000000000000000000000000000000000000000000000000";
const booking: Transaction = {
  trade: null,
  id: "readable-booking",
  date: "2026-09-02",
  amount_minor: -1250,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: fullPayee,
  description: fullDescription,
  source_counterparty: fullPayee,
  source_description: fullDescription,
  hidden: false,
  account_name: "Synthetic checking",
  category_id: null,
  category_source: "rule",
  category_rule_id: null,
  automatic_assignment: null,
  split: null,
  type: "expense",
  type_source: "auto",
  type_rule_id: null,
  account_id: "checking",
  manual_account: false,
  account_archived: false,
  counterpart_archived: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: null
};

async function showBooking(context: TestContext, transaction = booking) {
  const environment = browser(context);
  const { TransactionList } = await import("../src/features/transactions/components/transaction-list");
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const screen = render(withQueryClient(environment.queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: {
      current: null
    }
  }, createElement(TransactionList, {
    transactions: [transaction],
    categories: []
  }))));
  const details = screen.container.querySelector("details");

  assert.ok(details, "Full bank text needs a disclosure independently of whether a description exists.");
  const summary = details.querySelector("summary");

  assert.ok(summary);
  fireEvent.click(summary);
  assert.equal(details.open, true);

  return {
    screen,
    details
  };
}

test("reading full bank text exposes the complete labelled values and does not open transaction editing", async context => {
  const {
    screen,
    details
  } = await showBooking(context);
  const payee = within(details).getByText("Payee").nextElementSibling;
  const description = within(details).getByText("Description").nextElementSibling;

  assert.equal(payee?.textContent, fullPayee);
  assert.equal(description?.textContent, fullDescription);
  fireEvent.click(payee!);
  fireEvent.click(description!);
  assert.equal(screen.queryByRole("dialog"), null);
  fireEvent.click(details.querySelector("summary")!);
  assert.equal(details.open, false);
});

for (const example of [
  {
    name: "a payee without a description",
    counterparty: fullPayee,
    description: "",
    expectedPayee: fullPayee,
    expectedDescription: "No description"
  },
  {
    name: "a description without a payee",
    counterparty: "",
    description: fullDescription,
    expectedPayee: "Not provided",
    expectedDescription: fullDescription
  }
]) {
  test(`full text remains readable for ${example.name}`, async context => {
    const {
      screen,
      details
    } = await showBooking(context, {
      ...booking,
      counterparty: example.counterparty,
      description: example.description
    });

    assert.equal(within(details).getByText("Payee").nextElementSibling?.textContent, example.expectedPayee);
    assert.equal(within(details).getByText("Description").nextElementSibling?.textContent, example.expectedDescription);
    assert.equal(screen.queryByRole("dialog"), null);
  });
}

test("a description without a payee is the row's title and is not repeated as its description line", async context => {
  const {
    screen,
    details
  } = await showBooking(context, {
    ...booking,
    counterparty: "",
    description: "Standing order rent"
  });
  const visible = screen.getAllByText("Standing order rent").filter(element => !details.contains(element));

  assert.equal(visible.length, 1);
  assert.ok(visible[0]!.closest("button"), "The description takes the payee's place as the editable title.");
});
