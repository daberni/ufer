import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement, Fragment } from "react";
import type { Category } from "../src/features/categorization/types";
import type { Transaction } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient, type PendingRequest } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const categories: Category[] = [{
  id: "groceries",
  name: "Groceries",
  color: "#638777",
  is_transfer: 0,
  icon: null
}, {
  id: "leisure",
  name: "Leisure",
  color: "#cb8577",
  is_transfer: 0,
  icon: null
}];

function booking(id: string, counterparty: string): Transaction {
  return {
    id,
    booking_date: "2000-01-10",
    amount_minor: -1250,
    currency: "EUR",
    instructed_amount_minor: null,
    instructed_currency: null,
    counterparty,
    description: "Synthetic purchase",
    account_name: "Synthetic account",
    category_id: null,
    category_source: "rule"
  };
}

// jsdom has no modal dialogs; these stand in for showModal and close.
function modalDialogs() {
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

function choose(screen: RenderResult, counterparty: string, search: string) {
  const field = screen.getByRole("combobox", {
    name: `Category for ${counterparty}`
  });

  act(() => {
    fireEvent.change(field, {
      target: {
        value: search
      }
    });
  });
  act(() => {
    fireEvent.keyDown(field, {
      key: "Enter"
    });
  });
}

function assignment(id: string, categoryId: string) {
  return Response.json({
    id,
    category_id: categoryId,
    category_source: "manual"
  });
}

function patchFor(pending: PendingRequest[], id: string) {
  return pending.find(request => request.method === "PATCH" && request.url.pathname === `/api/transactions/${id}`);
}

test("the rule dialog keeps its row's offer and the edited pattern when a save on another row finishes", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  modalDialogs();

  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const market = booking("market-entry", "Example Market");
  const bakery = booking("bakery-entry", "Example Bakery");
  const screen = render(withQueryClient(queryClient, createElement(Fragment, null, createElement(TransactionCategory, {
    categories,
    transaction: market
  }), createElement(TransactionCategory, {
    categories,
    transaction: bakery
  }))));

  choose(screen, "Example Market", "Groc");
  await wait(0);
  await respond(patchFor(pending, market.id), assignment(market.id, "groceries"));

  // The other row's save is still pending while the dialog opens.
  choose(screen, "Example Bakery", "Leis");
  await wait(0);

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Create rule…"
    }));
  });

  const pattern = () => screen.getByRole("textbox", {
    name: "Matching pattern"
  }) as HTMLInputElement;

  assert.equal(pattern().value, "Example Market");
  act(() => {
    fireEvent.change(pattern(), {
      target: {
        value: "Example Mar"
      }
    });
  });

  await respond(pending.find(request => request.url.pathname === "/api/categories"), Response.json(categories));
  await respond(patchFor(pending, bakery.id), assignment(bakery.id, "leisure"));

  // The offer has moved to the other row, but the open dialog still belongs to the first one.
  assert.equal(screen.getAllByRole("button", {
    name: "Create rule…"
  }).length, 1);

  assert.ok(screen.getByRole("dialog", {
    name: "Create rule"
  }));
  assert.equal(pattern().value, "Example Mar");
  assert.equal((screen.getByRole("combobox", {
    name: "Category"
  }) as HTMLInputElement).value, "Groceries");
});
