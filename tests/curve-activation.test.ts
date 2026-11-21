import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { browser } from "./fixtures/browser";

async function showCurve(context: TestContext) {
  browser(context);
  const { useCurveActivation } = await import("../src/features/reports/use-curve-activation");

  function Curve() {
    const {
      active,
      curveProps
    } = useCurveActivation();

    return createElement("div", null, createElement("button", {
      type: "button",
      ...curveProps
    }, active ? "changes" : "amounts"), createElement("span", null, "outside"));
  }

  const view = render(createElement(Curve));

  return {
    curve: view.getByRole("button"),
    outside: view.getByText("outside")
  };
}

test("a mouse shows the changes only while it hovers the curve, even after a click", async context => {
  const { curve } = await showCurve(context);

  fireEvent.pointerEnter(curve, {
    pointerType: "mouse"
  });
  assert.equal(curve.textContent, "changes");

  fireEvent.pointerDown(curve, {
    pointerType: "mouse"
  });
  act(() => curve.focus());
  fireEvent.click(curve);
  fireEvent.pointerLeave(curve, {
    pointerType: "mouse"
  });
  assert.equal(curve.textContent, "amounts");
});

test("keyboard focus shows the changes until focus leaves or Escape", async context => {
  const { curve } = await showCurve(context);

  // jsdom treats every focus as visible; a browser does the same for keyboard focus.

  act(() => curve.focus());
  assert.equal(curve.textContent, "changes");
  act(() => curve.blur());
  assert.equal(curve.textContent, "amounts");

  act(() => curve.focus());
  fireEvent.keyDown(curve.ownerDocument, {
    key: "Escape"
  });
  assert.equal(curve.textContent, "amounts");

  // Enter or Space on the still-focused button arrives as a click without a pointer.
  fireEvent.click(curve);
  assert.equal(curve.textContent, "changes");
});

test("a tap toggles the changes and a press outside restores the amounts", async context => {
  const {
    curve,
    outside
  } = await showCurve(context);

  fireEvent.pointerDown(curve, {
    pointerType: "touch"
  });
  fireEvent.click(curve);
  assert.equal(curve.textContent, "changes");

  fireEvent.pointerDown(curve, {
    pointerType: "touch"
  });
  fireEvent.click(curve);
  assert.equal(curve.textContent, "amounts");

  fireEvent.pointerDown(curve, {
    pointerType: "touch"
  });
  fireEvent.click(curve);
  fireEvent.pointerDown(outside, {
    pointerType: "touch"
  });
  assert.equal(curve.textContent, "amounts");
});

test("a mouse press released elsewhere does not swallow the next keyboard focus", async context => {
  const { curve } = await showCurve(context);

  fireEvent.pointerDown(curve, {
    pointerType: "mouse"
  });
  act(() => curve.focus());
  act(() => curve.blur());

  // jsdom treats every focus as visible; a browser does the same for keyboard focus.
  act(() => curve.focus());
  assert.equal(curve.textContent, "changes");
});
