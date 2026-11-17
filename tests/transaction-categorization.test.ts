import assert from "node:assert/strict";
import { test } from "node:test";
import { act, renderHook } from "@testing-library/react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../src/client/query-keys";
import { useTransactionCategory } from "../src/features/transactions/use-transaction-category";
import { useRulePreview } from "../src/features/categorization/queries";
import type { Transaction, TransactionPage } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient, type PendingRequest } from "./fixtures/browser";

const transaction: Transaction = {
  id: "synthetic-entry",
  booking_date: "2000-01-10",
  amount_minor: -1250,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: "Example Market",
  description: "Synthetic purchase",
  account_name: "Synthetic account",
  account_id: "synthetic-account",
  category_id: "groceries",
  category_source: "rule",
  type: "expense",
  type_source: "auto",
  manual_account: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: null
};

const listKey = queryKeys.transactions.list({
  period: "2000-01",
  currency: "EUR",
  search: "",
  account: "",
  category: "",
  syncRun: "",
  page: 1
});

const cashFlowKey = queryKeys.reports.cashFlowFor({
  period: "2000-01",
  currency: "EUR"
});

function seed(queryClient: QueryClient) {
  queryClient.setQueryData<TransactionPage>(listKey, {
    period: {
      kind: "month",
      month: "2000-01"
    },
    page: 1,
    syncRun: null,
    transactionCount: 1,
    transactions: [transaction]
  });
  queryClient.setQueryData(cashFlowKey, {});
}

// Renders a row the way a view does: the stored transaction comes from the cached list page.
function renderRow(queryClient: QueryClient) {
  return renderHook(() => {
    const list = useQuery({
      queryKey: listKey,
      queryFn: () => new Promise<TransactionPage>(() => {}),
      staleTime: Infinity
    });
    const stored = list.data!.transactions[0];

    return {
      stored,
      row: useTransactionCategory(stored)
    };
  }, {
    wrapper: ({ children }) => withQueryClient(queryClient, children)
  });
}

function assignment(categoryId: string | null) {
  return Response.json({
    id: transaction.id,
    category_id: categoryId,
    category_source: "manual"
  });
}

function patches(pending: PendingRequest[]) {
  return pending.filter(request => request.method === "PATCH");
}

function refreshed(queryClient: QueryClient) {
  return queryClient.getQueryState(cashFlowKey)?.isInvalidated ?? false;
}

test("a category change shows at once and is replaced by the stored assignment", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  seed(queryClient);
  const { result } = renderRow(queryClient);

  act(() => result.current.row.change("leisure"));
  await wait(0);

  assert.equal(result.current.row.categoryId, "leisure");
  assert.equal(result.current.row.status?.kind, "saving");
  assert.equal(patches(pending).length, 1);
  assert.deepEqual(patches(pending)[0].body, {
    category_id: "leisure"
  });

  await respond(patches(pending)[0], assignment("leisure"));

  assert.equal(result.current.stored.category_id, "leisure");
  assert.equal(result.current.stored.category_source, "manual");
  assert.equal(result.current.row.categoryId, "leisure");
  assert.equal(result.current.row.status?.kind, "saved");
  assert.equal(refreshed(queryClient), true);
});

test("a failed change restores the stored category and reports the failure at the row", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  seed(queryClient);
  const { result } = renderRow(queryClient);

  act(() => result.current.row.change("leisure"));
  await wait(0);
  await respond(patches(pending)[0], Response.json({
    title: "Unprocessable Content",
    detail: "Category does not exist.",
    status: 422
  }, {
    status: 422
  }));

  assert.equal(result.current.stored.category_id, "groceries");
  assert.equal(result.current.row.categoryId, "groceries");
  assert.deepEqual(result.current.row.status, {
    kind: "failed",
    failure: {
      message: "Category does not exist.",
      traceId: undefined
    }
  });
});

test("quick changes to one row are saved in order and end at the latest selection", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  seed(queryClient);
  const { result } = renderRow(queryClient);

  act(() => result.current.row.change("leisure"));
  act(() => result.current.row.change("transport"));
  await wait(0);

  assert.equal(patches(pending).length, 1);
  assert.equal(result.current.row.categoryId, "transport");

  await respond(patches(pending)[0], assignment("leisure"));

  // The first response must not make the row jump back while the latest choice is still saving.
  assert.equal(result.current.row.categoryId, "transport");
  assert.equal(refreshed(queryClient), false);
  assert.equal(patches(pending).length, 2);
  assert.deepEqual(patches(pending)[1].body, {
    category_id: "transport"
  });

  await respond(patches(pending)[1], assignment("transport"));

  assert.equal(result.current.stored.category_id, "transport");
  assert.equal(result.current.row.categoryId, "transport");
  assert.equal(result.current.row.status?.kind, "saved");
  assert.equal(refreshed(queryClient), true);
});

test("a failed later change keeps the category stored by an earlier change", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  seed(queryClient);
  const { result } = renderRow(queryClient);

  act(() => result.current.row.change("leisure"));
  act(() => result.current.row.change(null));
  await wait(0);
  await respond(patches(pending)[0], assignment("leisure"));
  await respond(patches(pending)[1], Response.json({
    title: "Internal Server Error",
    detail: "Request failed.",
    status: 500
  }, {
    status: 500
  }));

  assert.equal(result.current.stored.category_id, "leisure");
  assert.equal(result.current.stored.category_source, "manual");
  assert.equal(result.current.row.categoryId, "leisure");
  assert.equal(result.current.row.status?.kind, "failed");
});

test("a row changed again after its view was left and reopened still waits for the earlier save", async context => {
  const {
    pending,
    queryClient
  } = browser(context);

  seed(queryClient);
  const first = renderRow(queryClient);

  act(() => first.result.current.row.change("leisure"));
  await wait(0);
  first.unmount();

  const second = renderRow(queryClient);

  assert.equal(second.result.current.row.categoryId, "leisure");
  assert.equal(second.result.current.row.status?.kind, "saving");

  act(() => second.result.current.row.change("transport"));
  await wait(0);

  assert.equal(patches(pending).length, 1);

  await respond(patches(pending)[0], assignment("leisure"));

  assert.equal(patches(pending).length, 2);
  assert.deepEqual(patches(pending)[1].body, {
    category_id: "transport"
  });
  assert.equal(second.result.current.row.categoryId, "transport");

  await respond(patches(pending)[1], assignment("transport"));

  assert.equal(second.result.current.stored.category_id, "transport");
  assert.equal(second.result.current.row.categoryId, "transport");
});

test("only the latest saved category assignment across rows offers a rule", async context => {
  const {
    pending,
    queryClient
  } = browser(context);
  const other: Transaction = {
    ...transaction,
    id: "other-entry",
    counterparty: "Example Bakery"
  };
  const { result } = renderHook(() => ({
    first: useTransactionCategory(transaction),
    second: useTransactionCategory(other)
  }), {
    wrapper: ({ children }) => withQueryClient(queryClient, children)
  });
  // Reads the current render's offer; assertions on one render must not narrow the next one.
  const offer = (row: "first" | "second") => result.current[row].ruleOffer;

  act(() => result.current.first.change("leisure"));
  await wait(0);

  // A pending change offers nothing yet.
  assert.equal(offer("first"), null);

  await respond(patches(pending)[0], assignment("leisure"));

  assert.equal(offer("first")?.categoryId, "leisure");

  act(() => result.current.second.change("groceries"));
  await wait(0);
  await respond(patches(pending)[1], Response.json({
    id: other.id,
    category_id: "groceries",
    category_source: "manual"
  }));

  assert.equal(offer("first"), null);
  assert.equal(offer("second")?.categoryId, "groceries");

  // Choosing "Uncategorized" gives a rule nothing to assign.
  act(() => result.current.second.change(null));
  await wait(0);
  await respond(patches(pending)[2], Response.json({
    id: other.id,
    category_id: null,
    category_source: "manual"
  }));

  assert.equal(offer("first"), null);
  assert.equal(offer("second"), null);
});


test("a settled category assignment refreshes an open rule preview and invalidates cached previews without touching unrelated data", async context => {
  const {
    queryClient,
    pending,
    requests
  } = browser(context);
  const draft = {
    pattern: "Example Market",
    priority: 100
  };
  const inactiveDraft = {
    pattern: "Example Bakery",
    priority: 100
  };

  queryClient.setQueryData(queryKeys.rulePreview(draft), {
    matched: 2,
    uncategorized: 2
  });
  queryClient.setQueryData(queryKeys.rulePreview(inactiveDraft), {
    matched: 3,
    uncategorized: 3
  });
  queryClient.setQueryData(queryKeys.accounts(), []);
  queryClient.setQueryData(queryKeys.categories(), []);
  const hook = renderHook(() => ({
    row: useTransactionCategory(transaction),
    preview: useRulePreview(draft)
  }), {
    wrapper: ({ children }) => withQueryClient(queryClient, children)
  });

  await wait(0);
  await respond(requests("rules/preview")[0], Response.json({
    matched: 2,
    uncategorized: 2
  }));
  act(() => hook.result.current.row.change("leisure"));
  await wait(0);
  await respond(patches(pending)[0], assignment("leisure"));

  assert.equal(requests("rules/preview").length, 2);
  assert.equal(queryClient.getQueryState(queryKeys.rulePreview(inactiveDraft))?.isInvalidated, true);
  assert.equal(queryClient.getQueryState(queryKeys.accounts())?.isInvalidated, false);
  assert.equal(queryClient.getQueryState(queryKeys.categories())?.isInvalidated, false);
  await respond(requests("rules/preview")[1], Response.json({
    matched: 1,
    uncategorized: 1
  }));
  assert.deepEqual(hook.result.current.preview.data, {
    matched: 1,
    uncategorized: 1
  });
});
