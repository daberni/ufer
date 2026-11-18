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

const previewId = "11111111-1111-4111-8111-111111111111";

const categories: Category[] = [{
  id: "groceries",
  name: "Groceries",
  color: "#638777",
  icon: null
}, {
  id: "leisure",
  name: "Leisure",
  color: "#cb8577",
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
    account_id: "synthetic-account",
    category_id: null,
    category_source: "rule",
    type: "expense",
    type_source: "auto",
    manual_account: false,
    entered: false,
    follows_import: false,
    created_counterpart: false,
    counterpart: null
  };
}

// jsdom has no Popover API; popover action queries include hidden content while exercising React's open/dismiss state.
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

// The latest change of a transaction; earlier ones have already been answered.
function patchFor(pending: PendingRequest[], id: string) {
  return pending.findLast(request => request.method === "PATCH" && request.url.pathname === `/api/transactions/${id}`);
}

test("the rule dialog posts its preview and keeps its row's offer and the edited pattern when a save on another row finishes", async context => {
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
      name: "Create rule…",
      hidden: true
    }));
  });

  const pattern = () => screen.getByRole("textbox", {
    name: "Matching pattern"
  }) as HTMLInputElement;

  assert.equal(pattern().value, "Example Market");

  // The preview posts the pattern, which comes from payee text, instead of putting it in the URL.
  await wait(0);
  const preview = pending.find(request => request.url.pathname === "/api/rules/preview");

  assert.equal(preview?.method, "POST");
  assert.equal(preview?.url.search, "");
  assert.deepEqual(preview?.body, {
    pattern: "Example Market",
    mode: "keyword",
    priority: 100
  });
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
    name: "Create rule…",
    hidden: true
  }).length, 1);

  assert.ok(screen.getByRole("dialog", {
    name: "Create rule"
  }));
  assert.equal(pattern().value, "Example Mar");
  assert.equal((screen.getByRole("combobox", {
    name: "Category"
  }) as HTMLInputElement).value, "Groceries");
});

test("a later change of the row retires the rule confirmation, so its failure is shown and announced on its own", async context => {
  const {
    pending,
    queryClient,
    requests
  } = browser(context);

  modalDialogs();

  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const market = booking("market-entry", "Example Market");
  const screen = render(withQueryClient(queryClient, createElement(TransactionCategory, {
    categories,
    transaction: market
  })));
  const confirmation = () => screen.queryAllByText(/Rule created/);

  choose(screen, "Example Market", "Groc");
  await wait(0);
  await respond(patchFor(pending, market.id), assignment(market.id, "groceries"));

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Create rule…",
      hidden: true
    }));
  });
  await wait(0);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 2,
    uncategorized: 2
  }));
  act(() => {
    fireEvent.submit(screen.getByRole("textbox", {
      name: "Matching pattern"
    }).closest("form")!);
  });
  await wait(0);
  await respond(requests("rules").find(request => request.method === "POST"), Response.json({
    ok: true,
    categorized: 2
  }, {
    status: 201
  }));

  // Creating the rule refreshes the rule queries, including the open preview, before the dialog closes.
  for (const preview of requests("rules/preview")) {
    await respond(preview, Response.json({
      id: previewId,
      matched: 0,
      uncategorized: 0
    }));
  }

  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(confirmation().length, 2);

  choose(screen, "Example Market", "Leis");
  await wait(0);

  assert.equal(confirmation().length, 0);

  await respond(patchFor(pending, market.id), Response.json({
    title: "Internal Server Error",
    detail: "Request failed.",
    status: 500
  }, {
    status: 500
  }));

  assert.equal(confirmation().length, 0);

  const announcement = screen.getAllByRole("status").find(region => region.getAttribute("aria-live") === "assertive");

  assert.equal(announcement?.textContent, "Category not saved: Request failed.");
});


test("the optional rule prompt keeps category focus, can be dismissed, and restores category focus after its dialog closes", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  modalDialogs();
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const market = booking("market-entry", "Example Market");
  const screen = render(withQueryClient(queryClient, createElement(TransactionCategory, {
    categories,
    transaction: market
  })));
  const field = screen.getByRole("combobox", {
    name: "Category for Example Market"
  });

  act(() => field.focus());
  choose(screen, "Example Market", "Groc");
  await wait(0);
  await respond(patchFor(pending, market.id), assignment(market.id, "groceries"));

  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, field);
  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Dismiss rule suggestion",
    hidden: true
  })));
  assert.equal(screen.queryByRole("button", {
    name: "Create rule…",
    hidden: true
  }), null);
  assert.equal(document.activeElement, field);

  choose(screen, "Example Market", "Leis");
  await wait(0);
  await respond(patchFor(pending, market.id), assignment(market.id, "leisure"));
  const create = screen.getByRole("button", {
    name: "Create rule…",
    hidden: true
  });

  act(() => {
    create.focus();
    fireEvent.click(create);
  });
  assert.ok(screen.getByRole("dialog", {
    name: "Create rule"
  }));
  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Close dialog"
  })));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(document.activeElement, field);
});

test("dismissing a rule prompt by pressing another category does not consume that category interaction", async context => {
  const {
    pending,
    queryClient
  } = browser(context);
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
  const otherField = screen.getByRole("combobox", {
    name: "Category for Example Bakery"
  });
  let continued = false;

  act(() => {
    continued = fireEvent.pointerDown(otherField);
    otherField.focus();
  });
  assert.equal(continued, true);
  assert.equal(screen.queryByRole("button", {
    name: "Create rule…",
    hidden: true
  }), null);
  choose(screen, "Example Bakery", "Leis");
  await wait(0);
  const request = patchFor(pending, bakery.id);

  assert.deepEqual(request?.body, {
    category_id: "leisure"
  });
  await respond(request, assignment(bakery.id, "leisure"));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(screen.getByRole("button", {
    name: "Create rule…",
    hidden: true
  }));
});

test("rule creation waits for the current pattern and priority preview, including debounce and failed requests", async context => {
  const {
    pending,
    queryClient,
    requests
  } = browser(context);

  modalDialogs();

  const { RuleFromAssignmentDialog } = await import("../src/features/categorization/components/rule-from-assignment-form");
  const screen = render(withQueryClient(queryClient, createElement(RuleFromAssignmentDialog, {
    counterparty: "Example Market",
    description: "Synthetic purchase",
    categoryId: "groceries",
    close: () => {},
    onCreated: () => {}
  })));
  const create = () => screen.getByRole("button", {
    name: "Create rule"
  }) as HTMLButtonElement;
  const pattern = screen.getByRole("textbox", {
    name: "Matching pattern"
  });
  const priority = screen.getByRole("spinbutton", {
    name: "Priority"
  });
  const form = pattern.closest("form")!;

  await wait(0);
  await respond(pending.find(request => request.url.pathname === "/api/categories"), Response.json(categories));
  assert.equal(create().disabled, true);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 2,
    uncategorized: 2
  }));
  assert.equal(create().disabled, false);

  act(() => fireEvent.change(pattern, {
    target: {
      value: "Salary"
    }
  }));
  assert.equal(create().disabled, true);
  assert.equal(screen.queryByText(/2 other transactions/), null);
  act(() => fireEvent.submit(form));
  assert.equal(requests("rules").filter(request => request.method === "POST").length, 0);
  await wait(350);
  assert.equal(create().disabled, true);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 8,
    uncategorized: 5
  }));
  assert.equal(create().disabled, false);

  act(() => fireEvent.change(priority, {
    target: {
      value: "5"
    }
  }));
  assert.equal(create().disabled, true);
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    title: "Unavailable",
    status: 503
  }, {
    status: 503
  }));
  assert.equal(create().disabled, true);
  act(() => fireEvent.submit(form));
  assert.equal(requests("rules").filter(request => request.method === "POST").length, 0);

  act(() => fireEvent.change(priority, {
    target: {
      value: "6"
    }
  }));
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 3,
    uncategorized: 1
  }));
  assert.equal(create().disabled, false);
  act(() => fireEvent.submit(form));
  await wait(0);
  const created = requests("rules").find(request => request.method === "POST");

  assert.deepEqual(created?.body, {
    id: previewId,
    name: "Salary",
    pattern: "Salary",
    mode: "keyword",
    category_id: "groceries",
    priority: 6,
    apply_to_uncategorized: true
  });
});
