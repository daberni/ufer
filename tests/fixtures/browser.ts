import assert from "node:assert/strict";
import { mock, type TestContext } from "node:test";
import { act, cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../../src/client/query-client";

// Responses, query notifications and React updates need a fixed number of event-loop turns, not elapsed time.
const settleTurns = 10;

export type PendingRequest = ReturnType<typeof Promise.withResolvers<Response>> & {
  url: URL;
  method: string;
  body: unknown;
};

/**
 * A browser environment whose fetch calls wait until the test resolves them, in any order. The query client uses the application's defaults.
 * setTimeout and Date are mocked, so time only passes through wait() and timing assertions do not depend on machine speed.
 */
export function browser(context: TestContext, url = "http://localhost/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url
  });
  const originalFetch = globalThis.fetch;
  const globals = {
    window: dom.window,
    // Next.js links schedule prefetching through self.requestIdleCallback.
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    FormData: dom.window.FormData,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  const originalProperties = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const pending: PendingRequest[] = [];
  const queryClient = createQueryClient();

  // jsdom has no layout; scrolling an element into view is a no-op there.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

  mock.timers.enable({
    apis: ["setTimeout", "Date"],
    now: Date.now()
  });

  globalThis.fetch = async (input, init) => {
    const request = Object.assign(Promise.withResolvers<Response>(), {
      url: new URL(String(input), "http://localhost"),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    });

    pending.push(request);

    return request.promise;
  };

  context.after(async () => {
    cleanup();
    queryClient.clear();
    // The query cache delivers notifications on a later turn; let them reach React while the DOM still exists.
    await settle();
    // Discarding the remaining timers, such as query garbage collection, keeps them from holding the process open.
    mock.timers.reset();
    dom.window.close();
    globalThis.fetch = originalFetch;

    for (const [key, descriptor] of originalProperties) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  return {
    pending,
    queryClient,
    requests: (path: string) => pending.filter(request => request.url.pathname === `/api/${path}`)
  };
}

export function withQueryClient(queryClient: QueryClient, children: ReactNode) {
  return createElement(QueryClientProvider, {
    client: queryClient
  }, children);
}

// setImmediate is not mocked: it lets promise chains such as reading a response body finish, while due timers run only when ticked.
async function settle() {
  for (let turn = 0; turn < settleTurns; turn++) {
    await new Promise(resolve => setImmediate(resolve));
    mock.timers.tick(0);
  }
}

/** Advances the mocked clock one millisecond at a time, so the work a timer starts settles before later timers are due. */
export async function wait(milliseconds: number) {
  await act(async () => {
    await settle();

    for (let elapsed = 0; elapsed < milliseconds; elapsed++) {
      mock.timers.tick(1);
      await settle();
    }
  });
}

/** Answers a pending request and lets the response reach React without advancing the clock. */
export async function respond(request: PendingRequest | undefined, response: Response) {
  assert.ok(request, "expected a request");
  await act(async () => {
    request.resolve(response);
    await settle();
  });
}
