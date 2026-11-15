import type { TestContext } from "node:test";
import { act, cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../../src/client/query-client";

// Captured before a test can replace the timers with mock timers.
const realSetTimeout = globalThis.setTimeout;

export type PendingRequest = ReturnType<typeof Promise.withResolvers<Response>> & {
  url: URL;
  method: string;
  body: unknown;
};

/**
 * A browser environment whose fetch calls wait until the test resolves them, in any order. The query client uses the application's defaults.
 */
export function browser(context: TestContext, url = "http://localhost/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url
  });
  const originalFetch = globalThis.fetch;
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true
  };
  const originalProperties = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const pending: PendingRequest[] = [];
  const queryClient = createQueryClient();

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  }

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
    await new Promise(resolve => realSetTimeout(resolve, 10));
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

export async function wait(milliseconds: number) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
  });
}
