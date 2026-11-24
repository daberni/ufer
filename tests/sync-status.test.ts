import assert from "node:assert/strict";
import { mock, test, type TestContext } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { syncResultLabelDuration, useSyncStatus } from "../src/features/banking/use-sync-status";
import { browser, respond, withQueryClient } from "./fixtures/browser";
import { withIntl } from "./fixtures/intl";

function renderSyncStatus(context: TestContext) {
  const {
    queryClient,
    requests
  } = browser(context);
  const { result } = renderHook(() => useSyncStatus(), {
    wrapper: ({ children }: {
      children: ReactNode
    }) => withIntl(withQueryClient(queryClient, children))
  });

  return {
    result,
    requests: () => requests("sync")
  };
}

async function startSync(result: ReturnType<typeof renderSyncStatus>["result"]) {
  await act(async () => {
    result.current.sync();
    await new Promise(resolve => setImmediate(resolve));
  });
}

function failed(detail: string, status = 409) {
  return Response.json({
    title: "Conflict",
    detail
  }, {
    status
  });
}

test("the sync button shows progress, then the outcome, then returns to its idle label", async context => {
  const {
    result,
    requests
  } = renderSyncStatus(context);

  assert.equal(result.current.phase, "idle");

  await startSync(result);
  assert.equal(result.current.phase, "syncing");
  assert.equal(result.current.politeAnnouncement, "Syncing transactions …");

  await startSync(result);
  assert.equal(requests().length, 1, "a second activation while syncing must not start another sync");

  await respond(requests()[0], Response.json({
    inserted: 3,
    failures: []
  }));
  assert.equal(result.current.phase, "synced");
  assert.equal(result.current.resultLabel, "3 new");
  assert.equal(result.current.problem, null);

  act(() => mock.timers.tick(syncResultLabelDuration - 1));
  assert.equal(result.current.phase, "synced");

  act(() => mock.timers.tick(1));
  assert.equal(result.current.phase, "idle");
});

test("a sync without new transactions reports that everything is up to date", async context => {
  const {
    result,
    requests
  } = renderSyncStatus(context);

  await startSync(result);
  await respond(requests()[0], Response.json({
    inserted: 0,
    failures: []
  }));

  assert.equal(result.current.resultLabel, "Up to date");
});

test("a sync problem stays reported until a later sync succeeds", async context => {
  const {
    result,
    requests
  } = renderSyncStatus(context);

  await startSync(result);
  await respond(requests()[0], Response.json({
    inserted: 2,
    failures: [{
      account: "Synthetic Savings",
      message: "Bank authorization has expired. Reconnect the bank.",
      reconnect: true
    }]
  }));

  assert.equal(result.current.phase, "idle");
  assert.equal(result.current.problem?.buttonLabel, "1 account failed");
  assert.equal(result.current.problem?.failures[0].account, "Synthetic Savings");
  assert.match(result.current.assertiveAnnouncement, /1 account failed/);

  act(() => mock.timers.tick(60_000));
  assert.equal(result.current.problem?.buttonLabel, "1 account failed");

  await startSync(result);
  assert.equal(result.current.phase, "syncing");
  assert.equal(result.current.problem?.buttonLabel, "1 account failed", "the warning stays while the next sync runs");

  await respond(requests()[1], failed("A sync is already running."));
  assert.equal(result.current.problem?.title, "Sync failed");
  assert.equal(result.current.problem?.note, "A sync is already running.");

  await startSync(result);
  await respond(requests()[2], Response.json({
    inserted: 0,
    failures: []
  }));
  assert.equal(result.current.problem, null);
  assert.equal(result.current.assertiveAnnouncement, "");
});

test("a dismissed sync problem is no longer exposed as an alert", async context => {
  const {
    result,
    requests
  } = renderSyncStatus(context);

  await startSync(result);
  await respond(requests()[0], failed("Request failed.", 500));
  assert.equal(result.current.assertiveAnnouncement, "Sync failed: Request failed.");

  act(() => result.current.dismissProblem());

  assert.equal(result.current.problem, null);
  assert.equal(result.current.assertiveAnnouncement, "");
});
