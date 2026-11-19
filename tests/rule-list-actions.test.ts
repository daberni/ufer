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
    category_icon: null
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
    uncategorized: 1
  }));

  assert.equal(create().disabled, true);
  assert.ok(screen.getByRole("button", {
    name: "Add a category"
  }));
  act(() => fireEvent.submit(create().closest("form")!));
  await wait(0);
  assert.equal(requests("rules").filter(request => request.method === "POST").length, 0);
});
