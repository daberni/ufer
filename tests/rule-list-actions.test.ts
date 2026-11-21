import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { queryKeys } from "../src/client/query-keys";
import type { Category, Rule } from "../src/features/categorization/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const previewId = "22222222-2222-4222-8222-222222222222";

function rule(id: string, priority: number): Rule {
  return {
    id,
    name: `Rule ${id}`,
    pattern: id.toUpperCase(),
    mode: "keyword",
    category_id: "groceries",
    category_name: "Groceries",
    priority,
    enabled: 1,
    category_color: "#638777",
    category_icon: null,
    transaction_type: null,
    transfer_account_id: null,
    transfer_account_name: null
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

test("applying rules right after a drop waits until the dropped order is saved", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const {
    useApplyRules,
    useReorderRules,
    useSavingRuleOrder
  } = await import("../src/features/categorization/mutations");
  const stored = [rule("a", 10), rule("b", 20)];

  queryClient.setQueryData(queryKeys.rules(), stored);
  const hook = renderHook(() => ({
    reorder: useReorderRules(),
    apply: useApplyRules(),
    saving: useSavingRuleOrder()
  }), {
    wrapper: ({ children }) => withQueryClient(queryClient, children)
  });

  let saved: Promise<void> | undefined;

  act(() => {
    saved = hook.result.current.reorder.save([stored[1], stored[0]]);
  });
  await wait(0);
  assert.equal(hook.result.current.saving, true);
  act(() => hook.result.current.apply.mutate());
  await wait(0);

  assert.equal(requests("rules/order").length, 1);
  assert.equal(requests("rules/apply").length, 0);

  await respond(requests("rules/order")[0], Response.json({
    ok: true
  }));
  await saved;
  await wait(0);

  assert.equal(requests("rules/apply").length, 1);
});

test("a rule cannot be created without a category, and the form offers to add one when none exist", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const noCategories: Category[] = [];

  modalDialogs();
  queryClient.setQueryData(queryKeys.categories(), noCategories);
  const { RuleDialog } = await import("../src/features/categorization/components/create-rule-form");
  const screen = render(withQueryClient(queryClient, createElement(RuleDialog, {
    rule: null,
    close: () => {}
  })));
  const create = () => screen.getByRole("button", {
    name: "Create rule"
  }) as HTMLButtonElement;

  act(() => fireEvent.change(screen.getByRole("textbox", {
    name: "Matching pattern"
  }), {
    target: {
      value: "MARKET"
    }
  }));
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    enabled: true,
    matched: 2,
    uncategorized: 1,
    matched_same_category: 0,
    manual: 0,
    manual_same_category: 0,
    transactions: [{
      id: "synthetic-market",
      booking_date: "2000-01-10",
      amount_minor: -1250,
      currency: "EUR",
      payee: "Example Market",
      description: "",
      category_id: null,
      manual: false
    }]
  }));

  // The count is the collapsed list's summary.
  assert.equal(screen.getByText("Example Market").closest("details")?.querySelector("summary")?.textContent, "Matches 2 transactions, 2 would change");
  assert.ok(screen.getByText("Example Market"));

  assert.equal(create().disabled, true);
  assert.ok(screen.getByRole("button", {
    name: "Add a category"
  }));
  act(() => fireEvent.submit(create().closest("form")!));
  await wait(0);
  assert.equal(requests("rules").filter(request => request.method === "POST").length, 0);
});

test("the match list shows manual assignments as unchanged until the rule may decide them, then as overridden", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
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

  modalDialogs();
  queryClient.setQueryData(queryKeys.categories(), categories);
  const { RuleDialog } = await import("../src/features/categorization/components/create-rule-form");
  const screen = render(withQueryClient(queryClient, createElement(RuleDialog, {
    rule: null,
    close: () => {}
  })));

  act(() => fireEvent.change(screen.getByRole("textbox", {
    name: "Matching pattern"
  }), {
    target: {
      value: "MARKET"
    }
  }));
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    enabled: true,
    matched: 1,
    uncategorized: 1,
    matched_same_category: 0,
    manual: 1,
    manual_same_category: 0,
    transactions: [{
      id: "synthetic-automatic",
      booking_date: "2000-01-11",
      amount_minor: -900,
      currency: "EUR",
      payee: "Example Market North",
      description: "",
      category_id: null,
      manual: false
    }, {
      id: "synthetic-manual",
      booking_date: "2000-01-10",
      amount_minor: -1250,
      currency: "EUR",
      payee: "Example Market South",
      description: "",
      category_id: "leisure",
      manual: true
    }]
  }));

  const row = (payee: string) => screen.getByText(payee).closest("li")!;
  const summary = () => screen.getByText("Example Market North").closest("details")?.querySelector("summary")?.textContent;

  assert.equal(summary(), "Matches 2 transactions, 1 would change");
  assert.match(row("Example Market South").textContent ?? "", /Leisure.*Manual, unchanged/);
  assert.doesNotMatch(row("Example Market South").textContent ?? "", /Groceries/);
  assert.match(row("Example Market North").textContent ?? "", /Uncategorized.*Groceries.*Would change/);

  const adopt = screen.getByRole("checkbox", {
    name: /Also let this rule decide 1 manually categorized transaction/
  });

  act(() => fireEvent.click(adopt));
  assert.equal(summary(), "Matches 2 transactions, 2 would change");
  assert.match(row("Example Market South").textContent ?? "", /Leisure.*Groceries.*Overrides manual/);

  act(() => fireEvent.click(adopt));
  assert.equal(summary(), "Matches 2 transactions, 1 would change");
  assert.match(row("Example Market South").textContent ?? "", /Manual, unchanged/);
});

test("a rejected order restores the earlier list and then reloads the stored one, including rules changed elsewhere", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const {
    useReorderRules
  } = await import("../src/features/categorization/mutations");
  const {
    useRules
  } = await import("../src/features/categorization/queries");
  const stored = [rule("a", 10), rule("b", 20)];

  queryClient.setQueryData(queryKeys.rules(), stored);
  const hook = renderHook(() => ({
    reorder: useReorderRules(),
    rules: useRules()
  }), {
    wrapper: ({ children }) => withQueryClient(queryClient, children)
  });
  let saved: Promise<void> | undefined;

  act(() => {
    saved = hook.result.current.reorder.save([stored[1], stored[0]]).catch(() => undefined);
  });
  await wait(0);
  await respond(requests("rules/order")[0], Response.json({
    title: "Conflict",
    status: 409,
    detail: "The rules have changed."
  }, {
    status: 409
  }));

  // Another tab added a rule in the meantime; the reload after the rollback shows it.
  const reload = requests("rules").filter(request => request.method === "GET").at(-1);

  await respond(reload, Response.json([...stored, rule("c", 30)]));
  await saved;
  await wait(0);

  assert.deepEqual(queryClient.getQueryData<Rule[]>(queryKeys.rules())?.map(entry => entry.id), ["a", "b", "c"]);
});

test("a failed older drop does not report a failure once a newer drop has been saved", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const {
    useRuleReorder
  } = await import("../src/features/categorization/components/use-rule-reorder");
  const stored = [rule("a", 10), rule("b", 20), rule("c", 30)];

  queryClient.setQueryData(queryKeys.rules(), stored);
  const hook = renderHook(() => useRuleReorder(queryClient.getQueryData<Rule[]>(queryKeys.rules()) ?? []), {
    wrapper: ({ children }) => withQueryClient(queryClient, children)
  });
  const drop = (active: string, over: string) => hook.result.current.onDragEnd({
    active: {
      id: active
    },
    over: {
      id: over
    }
  } as Parameters<typeof hook.result.current.onDragEnd>[0]);
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;

  act(() => {
    first = drop("a", "b");
  });
  act(() => {
    second = drop("a", "c");
  });
  await wait(0);
  await respond(requests("rules/order")[0], Response.json({
    title: "Unavailable",
    status: 503
  }, {
    status: 503
  }));
  await first;
  await wait(0);
  await respond(requests("rules/order")[1], Response.json({
    ok: true
  }));
  await second;
  await wait(0);

  assert.equal(hook.result.current.failure, null);
});

test("a rule can set the transfer type and its account, which the form sends with the rule", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const categories: Category[] = [{
    id: "savings",
    name: "Savings",
    color: "#638777",
    icon: null
  }];

  modalDialogs();
  queryClient.setQueryData(queryKeys.categories(), categories);
  queryClient.setQueryData(queryKeys.accounts(), [{
    id: "synthetic-savings",
    name: "Synthetic savings",
    archived_at: null
  }, {
    id: "synthetic-closed",
    name: "Synthetic closed",
    archived_at: "2026-09-01T00:00:00.000Z"
  }]);
  const { RuleDialog } = await import("../src/features/categorization/components/create-rule-form");
  const screen = render(withQueryClient(queryClient, createElement(RuleDialog, {
    rule: null,
    close: () => {}
  })));

  assert.equal(screen.queryByRole("combobox", {
    name: "Account"
  }), null);
  act(() => fireEvent.change(screen.getByRole("textbox", {
    name: "Rule name"
  }), {
    target: {
      value: "Savings plan"
    }
  }));
  act(() => fireEvent.change(screen.getByRole("textbox", {
    name: "Matching pattern"
  }), {
    target: {
      value: "SAVINGS PLAN"
    }
  }));
  act(() => fireEvent.change(screen.getByRole("combobox", {
    name: "Type"
  }), {
    target: {
      value: "transfer"
    }
  }));
  assert.equal(screen.queryByRole("option", {
    name: "Synthetic closed"
  }), null);
  act(() => fireEvent.change(screen.getByRole("combobox", {
    name: "Account"
  }), {
    target: {
      value: "synthetic-savings"
    }
  }));
  await wait(350);
  await respond(requests("rules/preview").at(-1), Response.json({
    id: previewId,
    enabled: true,
    matched: 1,
    uncategorized: 1,
    matched_same_category: 0,
    manual: 0,
    manual_same_category: 0,
    transactions: []
  }));

  const create = screen.getByRole("button", {
    name: "Create rule"
  }) as HTMLButtonElement;

  act(() => fireEvent.submit(create.closest("form")!));
  await wait(0);

  const saved = requests("rules").filter(request => request.method === "POST");

  const body = saved[0]?.body as Record<string, unknown> | undefined;

  assert.equal(saved.length, 1);
  assert.equal(body?.transaction_type, "transfer");
  assert.equal(body?.transfer_account_id, "synthetic-savings");
});

test("editing a transfer rule keeps its stored account while the account list is still loading", async context => {
  const {
    queryClient
  } = browser(context);

  modalDialogs();
  queryClient.setQueryData(queryKeys.categories(), [{
    id: "savings",
    name: "Savings",
    color: "#638777",
    icon: null
  }]);
  const { RuleDialog } = await import("../src/features/categorization/components/create-rule-form");
  const screen = render(withQueryClient(queryClient, createElement(RuleDialog, {
    rule: {
      id: "plan",
      name: "Savings plan",
      pattern: "SAVINGS PLAN",
      mode: "keyword",
      category_id: "savings",
      category_name: "Savings",
      priority: 100,
      enabled: 1,
      category_color: "#638777",
      category_icon: null,
      transaction_type: "transfer",
      transfer_account_id: "synthetic-savings",
      transfer_account_name: "Synthetic savings"
    },
    close: () => {}
  })));
  const account = screen.getByRole("combobox", {
    name: "Account"
  }) as HTMLSelectElement;

  assert.equal(account.value, "synthetic-savings");
  assert.ok(screen.getByRole("option", {
    name: "Synthetic savings"
  }));
});
