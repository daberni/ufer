import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { syncResultLabelDuration, useSyncStatus } from "../src/features/banking/use-sync-status";
import type { ActionResult, DashboardController } from "../src/features/dashboard/use-dashboard";

type Outcome = ActionResult<{
  inserted: number;
  failures: {
    account: string;
    message: string;
  }[];
}>;

function browser(context: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/"
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  const originalProperties = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

  context.mock.timers.enable({
    apis: ["setTimeout"]
  });

  context.after(() => {
    cleanup();
    dom.window.close();

    for (const [key, descriptor] of originalProperties) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}

// Each sync waits for the test to settle it, standing in for the request and dashboard refresh.
function controllablePerform() {
  const pending: ReturnType<typeof Promise.withResolvers<Outcome>>[] = [];

  const perform = (() => {
    const request = Promise.withResolvers<Outcome>();

    pending.push(request);

    return request.promise;
  }) as unknown as DashboardController["perform"];

  return {
    perform,
    pending
  };
}

test("the sync button shows progress, then the outcome, then returns to its idle label", async context => {
  browser(context);
  const {
    perform,
    pending
  } = controllablePerform();
  const { result } = renderHook(() => useSyncStatus(perform));

  assert.equal(result.current.phase, "idle");

  act(() => {
    result.current.sync();
  });
  assert.equal(result.current.phase, "syncing");
  assert.equal(result.current.politeAnnouncement, "Syncing transactions …");

  act(() => {
    result.current.sync();
  });
  assert.equal(pending.length, 1, "a second activation while syncing must not start another sync");

  await act(async () => pending[0].resolve({
    ok: true,
    value: {
      inserted: 3,
      failures: []
    }
  }));
  assert.equal(result.current.phase, "synced");
  assert.equal(result.current.resultLabel, "3 new");
  assert.equal(result.current.problem, null);

  act(() => context.mock.timers.tick(syncResultLabelDuration - 1));
  assert.equal(result.current.phase, "synced");

  act(() => context.mock.timers.tick(1));
  assert.equal(result.current.phase, "idle");
});

test("a sync without new transactions reports that everything is up to date", async context => {
  browser(context);
  const {
    perform,
    pending
  } = controllablePerform();
  const { result } = renderHook(() => useSyncStatus(perform));

  act(() => {
    result.current.sync();
  });
  await act(async () => pending[0].resolve({
    ok: true,
    value: {
      inserted: 0,
      failures: []
    }
  }));

  assert.equal(result.current.resultLabel, "Up to date");
});

test("a sync problem stays reported until a later sync succeeds", async context => {
  browser(context);
  const {
    perform,
    pending
  } = controllablePerform();
  const { result } = renderHook(() => useSyncStatus(perform));

  act(() => {
    result.current.sync();
  });
  await act(async () => pending[0].resolve({
    ok: true,
    value: {
      inserted: 2,
      failures: [{
        account: "Synthetic Savings",
        message: "Bank authorization has expired. Reconnect the bank."
      }]
    }
  }));

  assert.equal(result.current.phase, "idle");
  assert.equal(result.current.problem?.buttonLabel, "1 account failed");
  assert.equal(result.current.problem?.failures[0].account, "Synthetic Savings");
  assert.match(result.current.assertiveAnnouncement, /1 account failed/);

  act(() => context.mock.timers.tick(60_000));
  assert.equal(result.current.problem?.buttonLabel, "1 account failed");

  act(() => {
    result.current.sync();
  });
  assert.equal(result.current.phase, "syncing");
  assert.equal(result.current.problem?.buttonLabel, "1 account failed", "the warning stays while the next sync runs");

  await act(async () => pending[1].resolve({
    ok: false,
    message: "A sync is already running."
  }));
  assert.equal(result.current.problem?.title, "Sync failed");
  assert.equal(result.current.problem?.note, "A sync is already running.");

  act(() => {
    result.current.sync();
  });
  await act(async () => pending[2].resolve({
    ok: true,
    value: {
      inserted: 0,
      failures: []
    }
  }));
  assert.equal(result.current.problem, null);
  assert.equal(result.current.assertiveAnnouncement, "");
});
