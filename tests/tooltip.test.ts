import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const fullName = "Groceries and household supplies for the whole family";

// jsdom has no layout, so every element reports text wider than its box, as a truncated label would.
function truncatedText(context: TestContext) {
  const prototype = window.HTMLElement.prototype;

  Object.defineProperty(prototype, "scrollWidth", {
    configurable: true,
    value: 200
  });
  Object.defineProperty(prototype, "clientWidth", {
    configurable: true,
    value: 100
  });
  context.after(() => {
    Reflect.deleteProperty(prototype, "scrollWidth");
    Reflect.deleteProperty(prototype, "clientWidth");
  });
}

async function label(context: TestContext, container?: "link" | "hidden") {
  browser(context);
  truncatedText(context);
  const { Tooltip } = await import("../src/components/ui/tooltip");
  const tooltip = createElement(Tooltip, {
    text: fullName,
    describes: false,
    onlyWhenTruncated: true,
    children: trigger => createElement("span", {
      ...trigger,
      "data-testid": "label"
    }, fullName)
  });

  if (container === "link") {
    return render(createElement("a", {
      href: "/reports"
    }, tooltip));
  }

  if (container === "hidden") {
    return render(createElement("div", {
      "aria-hidden": "true"
    }, tooltip));
  }

  return render(tooltip);
}

test("a truncated label outside any control becomes a focus stop that shows its full text on keyboard focus", async context => {
  const screen = await label(context);
  const trigger = screen.getByTestId("label");

  assert.equal(trigger.getAttribute("tabindex"), "0");

  context.mock.method(trigger, "matches", (selector: string) => selector === ":focus-visible");
  await act(async () => trigger.focus());

  assert.equal(screen.getByRole("tooltip", {
    hidden: true
  }).textContent, fullName);
});

test("a truncated label inside a link shows its full text when the link receives keyboard focus", async context => {
  const screen = await label(context, "link");
  const link = screen.getByRole("link");

  assert.equal(screen.getByTestId("label").getAttribute("tabindex"), null);

  context.mock.method(link, "matches", (selector: string) => selector === ":focus-visible");
  await act(async () => link.focus());

  assert.equal(screen.getByRole("tooltip", {
    hidden: true
  }).textContent, fullName);

  await act(async () => link.blur());

  assert.equal(screen.getByRole("tooltip", {
    hidden: true
  }).textContent, "");
});

test("a truncated label inside decorative content stays out of the tab order", async context => {
  const screen = await label(context, "hidden");

  assert.equal(screen.getByTestId("label").getAttribute("tabindex"), null);
});
