import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement } from "react";
import type { Account } from "../src/features/accounts/types";
import type { Category, Rule } from "../src/features/categorization/types";
import type { Transaction } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const account = {
  id: "synthetic-bank-account",
  provider: "enable_banking"
} as Account;

const categories: Category[] = [{
  id: "groceries",
  name: "Groceries",
  color: "#638777",
  icon: null
}, {
  id: "leisure",
  name: "Leisure",
  color: "#c2aa6b",
  icon: null
}];

const rule = {
  id: "synthetic-rule",
  name: "Market",
  pattern: "MARKET",
  mode: "keyword",
  category_id: "groceries",
  category_name: "Groceries",
  priority: 100,
  enabled: 1,
  category_color: "#638777",
  category_icon: null
} satisfies Rule;

const transaction: Transaction = {
  id: "synthetic-entry",
  booking_date: "2000-01-10",
  amount_minor: -1250,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: "Example Market",
  description: "Synthetic purchase",
  source_counterparty: "Example Market",
  source_description: "Synthetic purchase",
  hidden: false,
  account_name: "Synthetic account",
  account_id: "synthetic-account",
  category_id: "groceries",
  category_source: "rule",
  category_rule_id: null,
  automatic_assignment: null,
  split: null,
  type: "expense",
  type_source: "auto",
  manual_account: false,
  account_archived: false,
  counterpart_archived: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: null
};

function controlsIn(screen: RenderResult) {
  return {
    sync: screen.getByRole("button", {
      name: /Sync|Syncing/
    }),
    applyRules: screen.getByRole("button", {
      name: "Apply rules"
    }),
    ruleSwitch: screen.getByRole("switch", {
      name: "Enable rule Market"
    }),
    category: screen.getByRole("combobox", {
      name: "Category for Example Market"
    })
  };
}

function chooseCategory(screen: RenderResult, name: string) {
  act(() => {
    fireEvent.click(controlsIn(screen).category);
  });
  // jsdom has no Popover API, so the opened list may count as hidden there.
  act(() => {
    fireEvent.click(screen.getByRole("option", {
      name,
      hidden: true
    }));
  });
}

test("an action in flight leaves the controls of every other action unchanged", async context => {
  const {
    queryClient,
    requests
  } = browser(context);
  const { SyncButton } = await import("../src/features/banking/components/sync-button");
  const { RulesView } = await import("../src/features/categorization/components/rules-view");
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const { AppStoreProvider } = await import("../src/client/app-store");

  const screen = render(withQueryClient(queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: {
      current: null
    }
  }, createElement(AppStoreProvider, {
    locked: false
  }, [
    createElement(SyncButton, {
      key: "sync",
      bankAccounts: [account],
      showConnections: () => {}
    }),
    createElement(RulesView, {
      key: "rules",
      categories: {
        data: categories,
        status: "ready"
      },
      rules: {
        data: [rule],
        status: "ready"
      }
    }),
    createElement(TransactionCategory, {
      key: "category",
      categories,
      transaction
    })
  ]))));

  const controls = () => controlsIn(screen);

  // A category save in flight.
  chooseCategory(screen, "Leisure");
  await wait(0);
  assert.equal(requests("transactions/synthetic-entry").length, 1);
  assert.match((controls().category as HTMLInputElement).value, /^Leisure/);
  assert.equal(controls().category.getAttribute("aria-busy"), "true");
  assert.equal(controls().sync.getAttribute("aria-label"), "Sync");
  assert.equal(controls().sync.getAttribute("aria-busy"), "false");
  assert.equal(controls().sync.hasAttribute("aria-disabled"), false);
  assert.equal(controls().sync.hasAttribute("disabled"), false);
  assert.equal(controls().applyRules.hasAttribute("disabled"), false);
  assert.equal(controls().ruleSwitch.hasAttribute("disabled"), false);

  // A sync in flight next to it.
  act(() => {
    fireEvent.click(controls().sync);
  });
  await wait(0);
  assert.equal(requests("sync").length, 1);
  // A syncing button keeps its focus, so it is marked unavailable instead of being disabled.
  assert.equal(controls().sync.getAttribute("aria-label"), "Syncing …");
  assert.equal(controls().sync.getAttribute("aria-busy"), "true");
  assert.equal(controls().sync.getAttribute("aria-disabled"), "true");
  assert.equal(controls().applyRules.hasAttribute("disabled"), false);
  assert.equal(controls().category.hasAttribute("disabled"), false);

  // Applying rules waits only for itself.
  act(() => {
    fireEvent.click(controls().applyRules);
  });
  await wait(0);
  assert.equal(controls().applyRules.hasAttribute("disabled"), true);
  assert.equal(controls().ruleSwitch.hasAttribute("disabled"), false);
  await respond(requests("rules/apply")[0], Response.json({
    updated: 0
  }));
  assert.equal(controls().applyRules.hasAttribute("disabled"), false);
  assert.equal(controls().sync.getAttribute("aria-label"), "Syncing …");
  assert.equal(controls().category.getAttribute("aria-busy"), "true");

  await respond(requests("sync")[0], Response.json({
    inserted: 0,
    failures: []
  }));
  assert.equal(controls().sync.getAttribute("aria-label"), "Synced: Up to date");
  assert.equal(controls().sync.getAttribute("aria-busy"), "false");
  assert.equal(controls().sync.hasAttribute("aria-disabled"), false);
  assert.equal(controls().category.getAttribute("aria-busy"), "true");
  assert.match((controls().category as HTMLInputElement).value, /^Leisure/);

  await respond(requests("transactions/synthetic-entry")[0], Response.json({
    id: transaction.id,
    category_id: "leisure",
    category_source: "manual"
  }));
  assert.equal(controls().category.getAttribute("aria-busy"), "false");
});
