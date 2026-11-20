import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement, createRef, Fragment, type ReactNode, type RefObject } from "react";
import type { QueryClient } from "@tanstack/react-query";
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
    source_counterparty: counterparty,
    source_description: "Synthetic purchase",
    hidden: false,
    account_name: "Synthetic account",
    account_id: "synthetic-account",
    category_id: null,
    category_source: "rule",
    category_rule_id: null,
    automatic_assignment: null,
    type: "expense",
    type_source: "auto",
    manual_account: false,
    entered: false,
    follows_import: false,
    created_counterpart: false,
    counterpart: null
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

function assignment(id: string, categoryId: string | null) {
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

async function transactionRuleScope(queryClient: QueryClient, fallbackFocus: RefObject<HTMLElement | null> = createRef<HTMLElement>()) {
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");

  return (children: ReactNode) => withQueryClient(queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus
  }, children));
}

test("an explicit category action keeps its draft when another row finishes saving", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  modalDialogs();
  const withRules = await transactionRuleScope(queryClient);

  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const market = {
    ...booking("market-entry", "Example Market"),
    category_id: "groceries",
    category_source: "manual" as const
  };
  let bakery = {
    ...booking("bakery-entry", "Example Bakery"),
    category_id: "leisure",
    category_source: "manual" as const
  };
  const rows = () => withRules(createElement(Fragment, null, createElement(TransactionCategory, {
    categories,
    transaction: market
  }), createElement(TransactionCategory, {
    categories,
    transaction: bakery
  })));
  const screen = render(rows());

  choose(screen, "Example Bakery", "Groc");
  await wait(0);
  const action = screen.getByRole("button", {
    name: "Create rule for Example Market"
  });

  act(() => {
    action.focus();
    fireEvent.click(action);
  });
  await wait(0);
  const preview = pending.find(request => request.url.pathname === "/api/rules/preview");

  assert.equal(preview?.method, "POST");
  assert.equal(preview?.url.search, "");
  assert.deepEqual(preview?.body, {
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    source_transaction_id: "market-entry"
  });
  const pattern = screen.getByRole("textbox", {
    name: "Matching pattern"
  }) as HTMLInputElement;

  act(() => fireEvent.change(pattern, {
    target: {
      value: "Example Mar"
    }
  }));
  await respond(pending.find(request => request.url.pathname === "/api/categories"), Response.json(categories));
  await respond(patchFor(pending, bakery.id), assignment(bakery.id, "groceries"));
  bakery = {
    ...bakery,
    category_id: "groceries"
  };
  screen.rerender(rows());

  assert.equal(pattern.value, "Example Mar");
  assert.equal((screen.getByRole("combobox", {
    name: "Category"
  }) as HTMLInputElement).value, "Groceries");
});

test("rule creation is announced quietly and a later failed assignment reports its own error", async context => {
  const {
    pending,
    queryClient,
    requests
  } = browser(context);

  modalDialogs();
  const withRules = await transactionRuleScope(queryClient);

  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const market = {
    ...booking("market-entry", "Example Market"),
    category_id: "groceries",
    category_source: "manual" as const
  };
  const screen = render(withRules(createElement(TransactionCategory, {
    categories,
    transaction: market
  })));
  const action = screen.getByRole("button", {
    name: "Create rule for Example Market"
  });

  act(() => {
    action.focus();
    fireEvent.click(action);
  });
  await wait(0);
  await respond(requests("categories")[0], Response.json(categories));
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 2,
    uncategorized: 2,
    manual: 0,
    manual_same_category: 0
  }));
  act(() => fireEvent.submit(screen.getByRole("textbox", {
    name: "Matching pattern"
  }).closest("form")!));
  await wait(0);
  await respond(requests("rules").find(request => request.method === "POST"), Response.json({
    ok: true,
    categorized: 2
  }, {
    status: 201
  }));

  for (const preview of requests("rules/preview").slice(1)) {
    await respond(preview, Response.json({
      id: previewId,
      matched: 0,
      uncategorized: 0,
      manual: 0,
      manual_same_category: 0
    }));
  }

  // The rule provider reads the rule list to open a category's assigning rule, so creating a rule refreshes it before the dialog closes.
  for (const list of requests("rules").filter(request => request.method === "GET")) {
    await respond(list, Response.json([]));
  }

  assert.equal(screen.queryAllByRole("dialog").length, 0);
  assert.ok(screen.getAllByRole("status").some(region => region.textContent === "Rule created; 2 transactions categorized."));
  assert.equal(document.activeElement === action, true);

  choose(screen, "Example Market", "Leis");
  await wait(0);
  assert.equal(screen.queryByText(/Rule created/), null);
  await respond(patchFor(pending, market.id), Response.json({
    title: "Internal Server Error",
    detail: "Request failed.",
    status: 500
  }, {
    status: 500
  }));
  assert.ok(screen.getAllByRole("status").some(region => region.textContent === "Category not saved: Request failed."));
  assert.equal(screen.queryAllByRole("dialog").length, 0);
});

test("saving never opens a prompt; the lightning action is explicit and disappears for Uncategorized", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  modalDialogs();
  const withRules = await transactionRuleScope(queryClient);

  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  let market = {
    ...booking("market-entry", "Example Market"),
    category_id: "groceries" as string | null,
    category_source: "rule" as "rule" | "manual"
  };
  const row = () => withRules(createElement(TransactionCategory, {
    categories,
    transaction: market
  }));
  const screen = render(row());
  const action = () => screen.getByRole("button", {
    name: "Create rule for Example Market"
  }) as HTMLButtonElement;

  assert.equal(Boolean(screen.queryByRole("button", {
    name: "Create rule for Example Market"
  })), false);
  const automaticSource = document.querySelector('[data-assignment-source="rule"]');

  assert.ok(automaticSource);
  assert.equal(automaticSource.tagName, "SPAN");
  act(() => fireEvent.click(automaticSource));
  assert.equal(screen.queryAllByRole("dialog").length, 0);
  choose(screen, "Example Market", "Leis");
  await wait(0);
  assert.equal(action().disabled, true);
  await respond(patchFor(pending, market.id), assignment(market.id, "leisure"));
  market = {
    ...market,
    category_id: "leisure",
    category_source: "manual"
  };
  screen.rerender(row());

  assert.equal(screen.queryAllByRole("region", {
    name: "Category saved",
    hidden: true
  }).length, 0);
  assert.equal(screen.queryAllByRole("dialog").length, 0);
  assert.equal(action().getAttribute("data-assignment-source"), "manual");
  act(() => {
    action().focus();
    fireEvent.click(action());
  });
  assert.ok(screen.getByRole("dialog", {
    name: "Create rule"
  }));
  act(() => fireEvent.click(screen.getByRole("button", {
    name: "Close dialog"
  })));
  assert.equal(document.activeElement === action(), true);

  choose(screen, "Example Market", "Uncat");
  await wait(0);
  await respond(patchFor(pending, market.id), assignment(market.id, null));
  market = {
    ...market,
    category_id: null
  };
  screen.rerender(row());
  assert.equal(Boolean(screen.queryByRole("button", {
    name: "Create rule for Example Market"
  })), false);
  assert.equal(screen.queryAllByRole("dialog").length, 0);
});

test("rule creation waits for the current pattern preview, including debounce and failed requests", async context => {
  const {
    pending,
    queryClient,
    requests
  } = browser(context);

  modalDialogs();
  const withRules = await transactionRuleScope(queryClient);

  const { RuleFromAssignmentDialog } = await import("../src/features/categorization/components/rule-from-assignment-form");
  const screen = render(withRules(createElement(RuleFromAssignmentDialog, {
    transactionId: "draft-entry",
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
  const form = pattern.closest("form")!;

  await wait(0);
  await respond(pending.find(request => request.url.pathname === "/api/categories"), Response.json(categories));
  assert.equal(create().disabled, true);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 2,
    uncategorized: 2,
    manual: 0,
    manual_same_category: 0
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
    uncategorized: 5,
    manual: 0,
    manual_same_category: 0
  }));
  assert.equal(create().disabled, false);

  act(() => fireEvent.change(pattern, {
    target: {
      value: "Salary payment"
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

  act(() => fireEvent.change(pattern, {
    target: {
      value: "Salary"
    }
  }));
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 3,
    uncategorized: 1,
    manual: 0,
    manual_same_category: 0
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
    apply_to_uncategorized: true,
    adopt_manual: false,
    source_transaction_id: "draft-entry"
  });
});

test("a rule proposed from an overridden booking uses the source's payee, which later deliveries match", async context => {
  const {
    queryClient,
    requests
  } = browser(context);

  modalDialogs();
  const headingRef = createRef<HTMLHeadingElement>();
  const withRules = await transactionRuleScope(queryClient, headingRef);
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const transaction = {
    ...booking("overridden-entry", "My market"),
    source_counterparty: "EXAMPLE MKT 0412",
    category_id: "groceries",
    category_source: "manual" as const
  };
  const screen = render(withRules(createElement(Fragment, null, createElement("h2", {
    ref: headingRef,
    tabIndex: -1
  }, "Transactions"), createElement(TransactionCategory, {
    categories,
    transaction
  }))));

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Create rule for My market"
    }));
  });
  await wait(0);
  await respond(requests("categories")[0], Response.json(categories));

  assert.equal((screen.getByRole("textbox", {
    name: "Matching pattern"
  }) as HTMLInputElement).value, "EXAMPLE MKT 0412");
});

test("an explicitly opened draft survives removal of its filtered source row and can still be submitted", async context => {
  const {
    queryClient,
    requests
  } = browser(context);

  modalDialogs();
  const headingRef = createRef<HTMLHeadingElement>();
  const withRules = await transactionRuleScope(queryClient, headingRef);

  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const transaction = {
    ...booking("filtered-entry", "Example Market"),
    category_id: "groceries",
    category_source: "manual" as const
  };
  const panel = (visible: boolean) => withRules(createElement(Fragment, null, createElement("h2", {
    ref: headingRef,
    tabIndex: -1
  }, "Transactions"), visible && createElement(TransactionCategory, {
    categories,
    transaction
  })));
  const screen = render(panel(true));
  const action = screen.getByRole("button", {
    name: "Create rule for Example Market"
  });

  act(() => {
    action.focus();
    fireEvent.click(action);
  });
  await wait(0);
  await respond(requests("categories")[0], Response.json(categories));
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 2,
    uncategorized: 2,
    manual: 0,
    manual_same_category: 0
  }));
  act(() => fireEvent.change(screen.getByRole("textbox", {
    name: "Matching pattern"
  }), {
    target: {
      value: "Edited Market"
    }
  }));
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    matched: 3,
    uncategorized: 3,
    manual: 0,
    manual_same_category: 0
  }));

  screen.rerender(panel(false));
  assert.ok(screen.queryByRole("dialog", {
    name: "Create rule"
  }));
  assert.equal((screen.getByRole("textbox", {
    name: "Matching pattern"
  }) as HTMLInputElement).value, "Edited Market");
  assert.equal((screen.getByRole("combobox", {
    name: "Category"
  }) as HTMLInputElement).value, "Groceries");
  act(() => fireEvent.submit(screen.getByRole("textbox", {
    name: "Matching pattern"
  }).closest("form")!));
  await wait(0);
  const created = requests("rules").find(request => request.method === "POST");

  assert.deepEqual(created?.body, {
    id: previewId,
    name: "Edited Market",
    pattern: "Edited Market",
    mode: "keyword",
    category_id: "groceries",
    apply_to_uncategorized: true,
    adopt_manual: false,
    source_transaction_id: "filtered-entry"
  });
  await respond(created, Response.json({
    ok: true,
    categorized: 3
  }, {
    status: 201
  }));

  for (const preview of requests("rules/preview").slice(2)) {
    await respond(preview, Response.json({
      id: previewId,
      matched: 0,
      uncategorized: 0,
      manual: 0,
      manual_same_category: 0
    }));
  }

  for (const list of requests("rules").filter(request => request.method === "GET")) {
    await respond(list, Response.json([]));
  }

  assert.equal(screen.queryAllByRole("dialog").length, 0);
  assert.equal(document.activeElement === headingRef.current, true);
});

test("a rule-assigned category opens its recorded rule, and an unrecorded one stays informational", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  modalDialogs();
  const withRules = await transactionRuleScope(queryClient);
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const recorded = {
    ...booking("recorded-entry", "Example Market"),
    category_id: "groceries",
    category_rule_id: "market-rule"
  };
  const unrecorded = {
    ...booking("unrecorded-entry", "Example Bakery"),
    category_id: "groceries"
  };
  const screen = render(withRules(createElement(Fragment, null, createElement(TransactionCategory, {
    categories,
    transaction: recorded
  }), createElement(TransactionCategory, {
    categories,
    transaction: unrecorded
  }))));

  await respond(pending.find(request => request.url.pathname === "/api/rules"), Response.json([{
    id: "market-rule",
    name: "Markets",
    pattern: "MARKET",
    mode: "keyword",
    category_id: "groceries",
    category_name: "Groceries",
    priority: 100,
    enabled: 1,
    category_color: "#638777",
    category_icon: null
  }]));

  const action = screen.getByRole("button", {
    name: "Open rule Markets"
  });

  assert.equal(screen.queryAllByRole("button", {
    name: /^Open rule/
  }).length, 1);
  assert.equal(screen.getAllByText("Assigned by a rule; source rule not recorded").length, 1);

  act(() => {
    action.focus();
    fireEvent.click(action);
  });
  await wait(0);

  const dialog = screen.getByRole("dialog", {
    name: "Edit rule"
  });

  assert.equal((dialog.querySelector("input[name='name']") as HTMLInputElement | null)?.value, "Markets");
});
