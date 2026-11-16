import assert from "node:assert/strict";
import { test } from "node:test";
import { createDashboardStore, onView } from "../src/features/dashboard/dashboard-store";

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

test("locking drops page feedback, and unlocking does not restore it", () => {
  const { state } = storeAt("/accounts");

  state().reportFeedback({
    tone: "problem",
    messages: ["Rule could not be enabled."]
  });
  state().lock();

  assert.equal(state().locked, true);
  assert.equal(state().feedback, null);

  state().unlock();
  assert.equal(state().locked, false);
  assert.equal(state().feedback, null);
});
