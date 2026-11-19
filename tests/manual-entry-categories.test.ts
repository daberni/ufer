import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Account } from "../src/features/accounts/types";
import { browser, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const account: Account = {
  id: "synthetic-cash",
  name: "Synthetic cash",
  provider_name: null,
  institution: "Example institution",
  kind: "checking",
  currency: "EUR",
  balance_minor: 10000,
  balance_date: "2026-09-01",
  provider: "manual",
  requisition_id: null,
  last_synced_at: null,
  valid_until: null,
  sync_error: null,
  archived_at: null
};

async function renderEntry(context: TestContext) {
  const environment = browser(context);

  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { ManualTransactionDialog } = await import("../src/features/transactions/components/manual-transaction-dialog");
  const screen = render(withQueryClient(environment.queryClient, createElement(ManualTransactionDialog, {
    accounts: [account],
    accountId: account.id,
    close: () => {}
  })));
  const category = screen.getByRole("combobox", {
    name: "Category (optional)"
  }) as HTMLInputElement;

  function choose(label: string) {
    act(() => {
      fireEvent.change(category, {
        target: {
          value: label
        }
      });
      fireEvent.keyDown(category, {
        key: "Enter"
      });
    });
  }

  async function submit() {
    act(() => {
      fireEvent.change(screen.getByRole("textbox", {
        name: "Amount"
      }), {
        target: {
          value: "-12.50"
        }
      });
      fireEvent.submit(screen.getByRole("button", {
        name: "Add transaction"
      }).closest("form")!);
    });
    await wait(0);

    return environment.requests("accounts/synthetic-cash/transactions")[0].body as Record<string, unknown>;
  }

  return {
    category,
    choose,
    submit
  };
}

test("a manual entry starts with Automatic and can return to it after an explicit choice", async context => {
  const entry = await renderEntry(context);

  assert.equal(entry.category.value, "Automatic");
  entry.choose("Uncategorized");
  assert.equal(entry.category.value, "Uncategorized");
  entry.choose("Automatic");
  assert.equal(entry.category.value, "Automatic");
  assert.equal(Object.hasOwn(await entry.submit(), "category_id"), false);
});

test("choosing Uncategorized in a manual entry sends an explicit null instead of requesting rules", async context => {
  const entry = await renderEntry(context);

  entry.choose("Uncategorized");
  assert.equal(entry.category.value, "Uncategorized");
  assert.equal((await entry.submit()).category_id, null);
});
