import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { stubCssModules } from "./fixtures/css-modules";
import { FormatLocaleProvider } from "../src/client/format-locale-provider";
import type { CategoryGroup } from "../src/features/reports/category-groups";

stubCssModules();

const groups: CategoryGroup[] = [{
  key: "rent",
  name: "Rent",
  combined: 0,
  color: "#4f7a5a",
  icon: null,
  amount: -123456,
  share: 0
}];

async function page(locale: string) {
  const { CategoryRows } = await import("../src/features/reports/components/category-rows");

  return createElement(FormatLocaleProvider, {
    locale,
    children: createElement(CategoryRows, {
      groups,
      currency: "EUR"
    })
  });
}

// The server resolves the locale once per request and hands it to the browser, so hydration finds the same text and keeps the server's markup.
for (const [locale, amount] of [["de-AT", "-€ 1.234,56"], ["en-US", "-€1,234.56"]]) {
  test(`the server and the hydrated browser format an amount alike in ${locale}`, async () => {
    const html = renderToString(await page(locale));
    const container = document.createElement("div");
    const errors: unknown[] = [];

    container.innerHTML = html;
    document.body.append(container);

    const serverAmount = container.querySelector("strong");
    const hydrated = await page(locale);
    let root: ReturnType<typeof hydrateRoot> | undefined;

    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true
    });

    await act(async () => {
      root = hydrateRoot(container, hydrated, {
        onRecoverableError: error => errors.push(error)
      });
    });

    assert.deepEqual(errors, []);
    assert.equal(container.querySelector("strong"), serverAmount);
    assert.equal(serverAmount?.textContent, amount);

    act(() => root?.unmount());
    container.remove();
  });
}
