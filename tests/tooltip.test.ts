import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { browser, wait } from "./fixtures/browser";
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

test("a label that becomes truncated with a new text becomes a focus stop, and leaves the tab order when it fits again", async context => {
  browser(context);
  const prototype = window.HTMLElement.prototype;
  let textWidth = 100;

  // jsdom has no layout, so the text width follows the label's current text.
  Object.defineProperty(prototype, "scrollWidth", {
    configurable: true,
    get: () => textWidth
  });
  Object.defineProperty(prototype, "clientWidth", {
    configurable: true,
    value: 100
  });
  context.after(() => {
    Reflect.deleteProperty(prototype, "scrollWidth");
    Reflect.deleteProperty(prototype, "clientWidth");
  });
  const { Tooltip } = await import("../src/components/ui/tooltip");
  const tooltip = (text: string) => createElement(Tooltip, {
    text,
    describes: false,
    onlyWhenTruncated: true,
    children: trigger => createElement("span", {
      ...trigger,
      "data-testid": "label"
    }, text)
  });
  const screen = render(tooltip("Groceries"));

  assert.equal(screen.getByTestId("label").getAttribute("tabindex"), null);

  textWidth = 200;
  screen.rerender(tooltip(fullName));

  assert.equal(screen.getByTestId("label").getAttribute("tabindex"), "0");

  textWidth = 100;
  screen.rerender(tooltip("Groceries"));

  assert.equal(screen.getByTestId("label").getAttribute("tabindex"), null);
});

async function labelInButton(context: TestContext, truncated: boolean) {
  browser(context);
  const prototype = window.HTMLElement.prototype;

  Object.defineProperty(prototype, "scrollWidth", {
    configurable: true,
    value: truncated ? 200 : 100
  });
  Object.defineProperty(prototype, "clientWidth", {
    configurable: true,
    value: 100
  });
  context.after(() => {
    Reflect.deleteProperty(prototype, "scrollWidth");
    Reflect.deleteProperty(prototype, "clientWidth");
  });
  const { Tooltip } = await import("../src/components/ui/tooltip");
  const clicks: string[] = [];
  const screen = render(createElement("button", {
    type: "button",
    onClick: () => clicks.push("edit")
  }, createElement(Tooltip, {
    text: fullName,
    describes: false,
    onlyWhenTruncated: true,
    children: trigger => createElement("span", {
      ...trigger,
      "data-testid": "label"
    }, fullName)
  })));

  return {
    screen,
    clicks
  };
}

test("a long press on a control whose text fits opens no tooltip and keeps the control's click", async context => {
  const {
    screen,
    clicks
  } = await labelInButton(context, false);
  const label = screen.getByTestId("label");

  fireEvent.pointerDown(label, {
    pointerType: "touch"
  });
  await wait(600);
  fireEvent.pointerUp(label, {
    pointerType: "touch"
  });
  fireEvent.click(label);

  assert.equal(screen.getByRole("tooltip", {
    hidden: true
  }).textContent, "");
  assert.deepEqual(clicks, ["edit"]);
});

test("a press inside an open tooltip does not activate the control around its trigger", async context => {
  const {
    screen,
    clicks
  } = await labelInButton(context, true);
  const label = screen.getByTestId("label");

  fireEvent.pointerDown(label, {
    pointerType: "touch"
  });
  await wait(600);
  fireEvent.pointerUp(label, {
    pointerType: "touch"
  });
  fireEvent.click(label);

  const tooltip = screen.getByRole("tooltip", {
    hidden: true
  });

  assert.equal(tooltip.textContent, fullName);

  fireEvent.click(tooltip);

  assert.deepEqual(clicks, []);
});
