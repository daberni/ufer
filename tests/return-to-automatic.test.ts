import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement, createRef, type ReactNode } from "react";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { insertRule } from "../src/features/categorization/server/rule-repository";
import { applyRulesToUncorrectedTransactions, createRule, previewRule, updateRuleDetails } from "../src/features/categorization/server/categorization-service";
import { updateTransactionCategory } from "../src/features/transactions/server/transaction-service";
import { HttpError } from "../src/lib/errors";
import { queryKeys } from "../src/client/query-keys";
import type { Category, Rule } from "../src/features/categorization/types";
import type { Transaction } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

async function seed(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;

  context.after(() => {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  await db.insert(schema.accounts).values([{
    id: "checking",
    environment: "SANDBOX",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  }, {
    id: "elsewhere",
    environment: "PRODUCTION",
    name: "Synthetic account in another environment",
    institution: "Example institution",
    kind: "checking"
  }]);

  const bookings: {
    id: string;
    counterparty: string;
    category_id?: string;
    category_source?: "rule" | "manual";
    account_id?: string;
  }[] = [
    {
      id: "manual-same",
      counterparty: "Example Market",
      category_id: "groceries",
      category_source: "manual"
    },
    {
      id: "manual-different",
      counterparty: "Example Market Central",
      category_id: "leisure",
      category_source: "manual"
    },
    // A higher-priority rule decides this one, so the market rule never takes it over.
    {
      id: "manual-express",
      counterparty: "Example Market Express",
      category_id: "leisure",
      category_source: "manual"
    },
    {
      id: "manual-unmatched",
      counterparty: "Other payee",
      category_id: "leisure",
      category_source: "manual"
    },
    {
      id: "automatic",
      counterparty: "Example Market"
    },
    {
      id: "manual-elsewhere",
      counterparty: "Example Market",
      category_id: "leisure",
      category_source: "manual",
      account_id: "elsewhere"
    }
  ];

  await db.insert(schema.transactions).values(bookings.map((booking, index) => ({
    account_id: "checking",
    provider_reference: `synthetic-${index}`,
    booking_date: "2000-01-10",
    amount_minor: -1000,
    type: "expense" as const,
    currency: "EUR",
    ...booking
  })));
  await insertRule({
    id: "express-rule",
    name: "Express",
    pattern: "Express",
    mode: "keyword",
    category_id: "transport",
    priority: 10,
    enabled: true
  });

  return db;
}

async function assignments(db: Database) {
  const rows = await db.select({
    id: schema.transactions.id,
    category_id: schema.transactions.category_id,
    category_source: schema.transactions.category_source,
    category_rule_id: schema.transactions.category_rule_id
  }).from(schema.transactions);

  return Object.fromEntries(rows.map(row => [row.id, `${row.category_id ?? "none"}/${row.category_source}/${row.category_rule_id ?? "none"}`]));
}

test("returning a manual assignment to automatic stores what applying the rules assigns, with the deciding rule", async context => {
  const db = await seed(context);

  await insertRule({
    id: "market-rule",
    name: "Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    enabled: true
  });

  assert.deepEqual(await updateTransactionCategory("manual-different", {
    automatic: true
  }), {
    id: "manual-different",
    category_id: "groceries",
    category_source: "rule",
    category_rule_id: "market-rule"
  });
  assert.deepEqual(await updateTransactionCategory("manual-express", {
    automatic: true
  }), {
    id: "manual-express",
    category_id: "transport",
    category_source: "rule",
    category_rule_id: "express-rule"
  });
  // Without a matching rule the transaction becomes uncategorized and follows later rules.
  assert.deepEqual(await updateTransactionCategory("manual-unmatched", {
    automatic: true
  }), {
    id: "manual-unmatched",
    category_id: null,
    category_source: "rule",
    category_rule_id: null
  });

  const returned = await assignments(db);

  // Applying the rules afterwards changes nothing about the returned transactions.
  await applyRulesToUncorrectedTransactions();
  const applied = await assignments(db);

  for (const id of ["manual-different", "manual-express", "manual-unmatched"]) {
    assert.equal(applied[id], returned[id], id);
  }

  assert.equal(applied["manual-same"], "groceries/manual/none");
  await assert.rejects(updateTransactionCategory("manual-elsewhere", {
    automatic: true
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
  assert.equal((await assignments(db))["manual-elsewhere"], "leisure/manual/none");
});

test("a rule preview counts the manual assignments it decides and those that already have its category", async context => {
  await seed(context);

  const preview = await previewRule({
    pattern: "Example Market",
    mode: "keyword",
    priority: 100,
    category_id: "groceries"
  });

  assert.equal(preview.matched, 1);
  assert.equal(preview.manual, 2);
  assert.equal(preview.manual_same_category, 1);

  // The transaction a rule is created from is adopted on its own terms and not counted again.
  const fromSource = await previewRule({
    pattern: "Example Market",
    mode: "keyword",
    priority: 100,
    category_id: "groceries",
    source_transaction_id: "manual-same"
  });

  assert.equal(fromSource.manual, 1);
  assert.equal(fromSource.manual_same_category, 0);
});

test("a new rule takes over only the chosen manual assignments it decides and records itself", async context => {
  const db = await seed(context);
  const before = await assignments(db);

  await createRule({
    name: "Market kept manual",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 200
  });
  assert.deepEqual(await assignments(db), before);

  const created = await previewRule({
    pattern: "Example Market",
    mode: "keyword",
    priority: 100,
    category_id: "groceries"
  });

  await createRule({
    id: created.id,
    name: "Market",
    pattern: "Example Market",
    mode: "keyword",
    category_id: "groceries",
    priority: 100,
    adopt_manual: true
  });

  const after = await assignments(db);

  assert.equal(after["manual-same"], `groceries/rule/${created.id}`);
  assert.equal(after["manual-different"], `groceries/rule/${created.id}`);
  assert.equal(after["manual-express"], "leisure/manual/none");
  assert.equal(after["manual-unmatched"], "leisure/manual/none");
  assert.equal(after["manual-elsewhere"], "leisure/manual/none");
  // Adopting manual assignments does not apply the rule to automatic transactions.
  assert.equal(after.automatic, before.automatic);
});

test("saving an edited rule can take over the manual assignments it decides", async context => {
  const db = await seed(context);

  await insertRule({
    id: "market-rule",
    name: "Market",
    pattern: "Nothing yet",
    mode: "keyword",
    category_id: "transport",
    priority: 100,
    enabled: true
  });
  await updateRuleDetails("market-rule", {
    name: "Market",
    pattern: "Central",
    mode: "keyword",
    category_id: "groceries"
  });
  assert.equal((await assignments(db))["manual-different"], "leisure/manual/none");

  await updateRuleDetails("market-rule", {
    name: "Market",
    pattern: "Central",
    mode: "keyword",
    category_id: "groceries",
    adopt_manual: true
  });

  const after = await assignments(db);

  assert.equal(after["manual-different"], "groceries/rule/market-rule");
  assert.equal(after["manual-same"], "groceries/manual/none");
});

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

const marketRule: Rule = {
  id: "market-rule",
  name: "Market",
  pattern: "Market",
  mode: "keyword",
  category_id: "groceries",
  category_name: "Groceries",
  priority: 100,
  enabled: 1,
  category_color: "#638777",
  category_icon: null,
  transaction_type: null,
  transfer_account_id: null,
  transfer_account_name: null
};

function booking(overrides: Partial<Transaction>): Transaction {
  return {
    id: "market-entry",
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
    category_id: "leisure",
    category_source: "manual",
    category_rule_id: null,
    automatic_assignment: {
      category_id: "groceries",
      rule_id: "market-rule"
    },
    split: null,
    type: "expense",
    type_source: "auto",
    type_rule_id: null,
    manual_account: false,
    account_archived: false,
    counterpart_archived: false,
    entered: false,
    follows_import: false,
    created_counterpart: false,
    counterpart: null,
    ...overrides
  };
}

async function renderRow(harness: ReturnType<typeof browser>, transaction: Transaction) {
  harness.queryClient.setQueryData(queryKeys.rules(), [marketRule]);
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const scope = (children: ReactNode) => withQueryClient(harness.queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: createRef<HTMLElement>()
  }, children));
  const screen = render(scope(createElement(TransactionCategory, {
    categories,
    transaction
  })));
  const field = screen.getByRole("combobox", {
    name: "Category for Example Market"
  });

  act(() => {
    fireEvent.change(field, {
      target: {
        value: "Automatic"
      }
    });
  });

  return {
    ...harness,
    screen,
    field
  };
}

test("a manually categorized row offers to return to automatic, named by what the rules assign, and the server decides the result", async context => {
  const {
    pending,
    screen,
    field
  } = await renderRow(browser(context), booking({}));

  assert.ok(screen.getByRole("option", {
    name: "Automatic · Groceries via rule “Market”",
    hidden: true
  }));

  act(() => {
    fireEvent.keyDown(field, {
      key: "Enter"
    });
  });
  await wait(0);
  const patch = pending.find(request => request.method === "PATCH");

  assert.deepEqual(patch?.body, {
    automatic: true
  });
  // The predicted category shows while the server decides.
  assert.equal((field as HTMLInputElement).value, "Groceries");
  await respond(patch, Response.json({
    id: "market-entry",
    category_id: "groceries",
    category_source: "rule",
    category_rule_id: "market-rule"
  }));
});

test("without a matching rule the option names Uncategorized, and rule-assigned rows do not offer it", async context => {
  const harness = browser(context);
  const unmatched = await renderRow(harness, booking({
    automatic_assignment: {
      category_id: null,
      rule_id: null
    }
  }));

  assert.ok(unmatched.screen.getByRole("option", {
    name: "Automatic · Uncategorized",
    hidden: true
  }));
  unmatched.screen.unmount();

  const automatic = await renderRow(harness, booking({
    category_id: "groceries",
    category_source: "rule",
    category_rule_id: "market-rule",
    automatic_assignment: null
  }));

  assert.equal(automatic.screen.queryByRole("option", {
    name: /^Automatic/,
    hidden: true
  }), null);
});

type Matches = {
  count: number;
  sameCategory: number;
} | null;

test("a manually categorized row's list opens at the Automatic option rather than the selected category", async context => {
  const harness = browser(context);

  harness.queryClient.setQueryData(queryKeys.rules(), [marketRule]);
  const { TransactionRuleProvider } = await import("../src/features/transactions/components/transaction-rule-provider");
  const { TransactionCategory } = await import("../src/features/transactions/components/transaction-category");
  const row = (transaction: Transaction) => withQueryClient(harness.queryClient, createElement(TransactionRuleProvider, {
    fallbackFocus: createRef<HTMLElement>()
  }, createElement(TransactionCategory, {
    categories,
    transaction
  })));
  const activeOption = (screen: ReturnType<typeof render>) => {
    const field = screen.getByRole("combobox", {
      name: "Category for Example Market"
    });

    act(() => {
      fireEvent.click(field);
    });

    return screen.baseElement.querySelector("[role=option][data-active]")?.textContent;
  };
  const manual = render(row(booking({})));

  assert.equal(activeOption(manual), "Automatic · Groceries via rule “Market”");
  manual.unmount();

  const automatic = render(row(booking({
    category_id: "leisure",
    category_source: "rule",
    category_rule_id: "market-rule",
    automatic_assignment: null
  })));

  assert.equal(activeOption(automatic), "Leisure");
});

async function renderAdoption(matches: Matches) {
  const {
    ManualAdoptionOption,
    useManualAdoption
  } = await import("../src/features/categorization/components/manual-adoption-option");
  let submitted = false;

  function Harness() {
    const adoption = useManualAdoption(matches);

    submitted = adoption.checked;

    return createElement("form", null, createElement(ManualAdoptionOption, {
      adoption
    }));
  }

  const screen = render(createElement(Harness));

  return {
    screen,
    submitted: () => submitted
  };
}

test("the rule editor's manual-assignment option is preselected only when every match already has the rule's category", async context => {
  browser(context);
  const same = await renderAdoption({
    count: 2,
    sameCategory: 2
  });
  const sameOption = same.screen.getByRole("checkbox", {
    name: "Also let this rule decide 2 manually categorized transactions"
  }) as HTMLInputElement;

  assert.equal(sameOption.checked, true);
  assert.equal(same.submitted(), true);
  same.screen.unmount();

  const mixed = await renderAdoption({
    count: 3,
    sameCategory: 1
  });
  const mixedOption = mixed.screen.getByRole("checkbox", {
    name: "Also let this rule decide 3 manually categorized transactions"
  }) as HTMLInputElement;

  assert.equal(mixedOption.checked, false);
  act(() => {
    fireEvent.click(mixedOption);
  });
  assert.equal(mixed.submitted(), true);
  mixed.screen.unmount();

  const none = await renderAdoption({
    count: 0,
    sameCategory: 0
  });

  assert.equal(none.screen.queryByRole("checkbox"), null);
  assert.equal(none.submitted(), false);
});
