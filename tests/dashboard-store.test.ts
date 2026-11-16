import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardStore, onView } from "../src/features/dashboard/dashboard-store";
import type { Account } from "../src/features/dashboard/types";

const account = {
  id: "synthetic-manual-account",
  name: "Synthetic savings",
  provider: "manual",
  currency: "EUR"
} as Account;

function storeAt(pathname: string) {
  const location = {
    pathname
  };
  const store = createDashboardStore(() => location.pathname);

  return {
    store,
    state: () => store.getState(),
    navigate: (next: string) => {
      location.pathname = next;
      store.getState().enterView(next);
    }
  };
}

test("a dialog opens with its payload and belongs to the view it was opened on", () => {
  const {
    state,
    navigate
  } = storeAt("/accounts");

  state().openDialog({
    kind: "balance",
    account
  });

  assert.deepEqual(onView(state().dialog, "/accounts"), {
    kind: "balance",
    account
  });
  // Hidden as soon as another view renders, before the navigation clears it.
  assert.equal(onView(state().dialog, "/"), null);

  navigate("/");
  navigate("/accounts");

  // Back to the view does not bring the dialog or its account back.
  assert.equal(state().dialog, null);
});

test("opening another dialog replaces the payload of the previous one", () => {
  const { state } = storeAt("/rules");

  state().openDialog({
    kind: "editCategory",
    category: {
      id: "groceries",
      name: "Groceries",
      color: "#638777",
      is_transfer: 0,
      icon: null
    }
  });
  state().closeDialog();
  state().openDialog({
    kind: "category"
  });

  assert.deepEqual(onView(state().dialog, "/rules"), {
    kind: "category"
  });
});

test("page feedback stays on its view and is dropped by a navigation", () => {
  const {
    state,
    navigate
  } = storeAt("/connections");
  const feedback = {
    tone: "success" as const,
    messages: ["Bank connected."]
  };

  state().reportFeedback(feedback);
  navigate("/connections");
  assert.deepEqual(onView(state().feedback, "/connections"), feedback);

  navigate("/transactions");
  assert.equal(state().feedback, null);
});

test("locking drops the open dialog and page feedback, and unlocking does not restore them", () => {
  const { state } = storeAt("/accounts");

  state().openDialog({
    kind: "balance",
    account
  });
  state().reportFeedback({
    tone: "problem",
    messages: ["Rule could not be enabled."]
  });
  state().lock();

  assert.equal(state().locked, true);
  assert.equal(state().dialog, null);
  assert.equal(state().feedback, null);

  state().unlock();
  assert.equal(state().locked, false);
  assert.equal(state().dialog, null);
});
