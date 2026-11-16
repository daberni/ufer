import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, useRef } from "react";
import { useDismiss, type Dismissal } from "../src/components/ui/use-dismiss";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

// jsdom has no modal dialogs; these stand in for showModal and close, including the close event that follows Escape.
function modalDialogs(context: TestContext) {
  browser(context);

  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };
}

async function renderDialog(context: TestContext) {
  modalDialogs(context);

  const { Dialog } = await import("../src/components/ui/dialog");

  const trigger = document.createElement("button");
  const closes: string[] = [];

  document.body.append(trigger);
  trigger.focus();

  const screen = render(createElement(Dialog, {
    title: "Update balance",
    onClose: () => {
      closes.push("closed");
    },
    children: createElement("input", {
      "aria-label": "New balance"
    })
  }));
  const dialog = screen.container.ownerDocument.querySelector("dialog")!;

  return {
    ...screen,
    closes,
    dialog,
    field: screen.getByLabelText("New balance"),
    trigger
  };
}

test("a press that starts and ends on the backdrop closes the dialog", async context => {
  const {
    closes,
    dialog
  } = await renderDialog(context);

  assert.equal(dialog.open, true);

  fireEvent.pointerDown(dialog);
  fireEvent.click(dialog);

  assert.deepEqual(closes, ["closed"]);
});

test("a text selection dragged from a field onto the backdrop keeps the dialog open", async context => {
  const {
    closes,
    dialog,
    field
  } = await renderDialog(context);

  // The browser targets the click at the common ancestor of where the press started and ended: the dialog itself.
  fireEvent.pointerDown(field);
  fireEvent.click(dialog);
  // A later press on content followed by a stray click on the dialog does not count either.
  fireEvent.pointerDown(dialog);
  fireEvent.pointerDown(field);
  fireEvent.click(dialog);

  assert.deepEqual(closes, []);
});

test("Escape closes through the browser's close event, and unmounting restores focus to the trigger", async context => {
  const {
    closes,
    dialog,
    trigger,
    unmount
  } = await renderDialog(context);

  // Escape makes the browser close the dialog, which then fires close.
  act(() => dialog.close());
  assert.deepEqual(closes, ["closed"]);

  unmount();
  assert.equal(document.activeElement, trigger);
});

test("unmounting an open dialog, as on navigation or locking, closes it without reporting a dismissal", async context => {
  const {
    closes,
    dialog,
    unmount
  } = await renderDialog(context);

  unmount();

  assert.equal(dialog.open, false);
  assert.deepEqual(closes, []);
});

function renderDismiss(context: TestContext, withInside = true) {
  browser(context);

  const content = document.createElement("div");
  const trigger = document.createElement("button");
  const outside = document.createElement("button");
  const field = document.createElement("input");
  const dismissals: Dismissal[] = [];

  content.append(field);
  document.body.append(trigger, content, outside);

  const hook = renderHook(({ active }) => {
    const contentRef = useRef(content);
    const triggerRef = useRef(trigger);

    useDismiss({
      active,
      inside: withInside ? [contentRef, triggerRef] : undefined,
      onDismiss: dismissal => dismissals.push(dismissal)
    });
  }, {
    initialProps: {
      active: true
    }
  });

  return {
    ...hook,
    dismissals,
    field,
    outside,
    trigger
  };
}

test("a press outside dismisses, while presses on the content or its trigger do not", context => {
  const {
    dismissals,
    field,
    outside,
    trigger
  } = renderDismiss(context);

  fireEvent.pointerDown(field);
  fireEvent.pointerDown(trigger);
  assert.deepEqual(dismissals, []);

  fireEvent.pointerDown(outside);
  assert.deepEqual(dismissals, [{
    reason: "outside",
    focusInside: false
  }]);
});

test("Escape dismisses and reports whether focus was inside, so the caller can return it to the trigger", context => {
  const {
    dismissals,
    field,
    outside
  } = renderDismiss(context);

  field.focus();
  fireEvent.keyDown(field, {
    key: "Escape"
  });
  outside.focus();
  fireEvent.keyDown(outside, {
    key: "Escape"
  });

  assert.deepEqual(dismissals, [{
    reason: "escape",
    focusInside: true
  }, {
    reason: "escape",
    focusInside: false
  }]);
});

test("Escape that a control already handled, or that belongs to an open modal dialog, does not dismiss", context => {
  const {
    dismissals,
    field
  } = renderDismiss(context);

  field.addEventListener("keydown", event => event.preventDefault());
  fireEvent.keyDown(field, {
    key: "Escape"
  });

  const modal = document.createElement("dialog");

  modal.setAttribute("open", "");
  document.body.append(modal);
  fireEvent.keyDown(document.body, {
    key: "Escape"
  });

  assert.deepEqual(dismissals, []);
});

test("without inside elements only Escape dismisses, and inactive content observes nothing", context => {
  const {
    dismissals,
    outside,
    rerender
  } = renderDismiss(context, false);

  fireEvent.pointerDown(outside);
  assert.deepEqual(dismissals, []);

  rerender({
    active: false
  });
  fireEvent.keyDown(outside, {
    key: "Escape"
  });
  assert.deepEqual(dismissals, []);
});
