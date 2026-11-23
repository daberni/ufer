import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, type RenderResult } from "@testing-library/react";
import { render } from "./fixtures/intl";
import { createElement, useState } from "react";
import type { Category } from "../src/features/categorization/types";
import { suggestedCategoryColors } from "../src/features/categorization/category-colors";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const groceries: Category = {
  id: "groceries",
  name: "Groceries",
  color: "#638777",
  icon: null
};

function categoryField(screen: RenderResult) {
  return screen.getByRole("combobox", {
    name: "Category"
  }) as HTMLInputElement;
}

function type(field: HTMLInputElement, text: string) {
  act(() => {
    fireEvent.change(field, {
      target: {
        value: text
      }
    });
  });
}

function press(field: HTMLInputElement, key: string) {
  act(() => {
    fireEvent.keyDown(field, {
      key
    });
  });
}

function optionLabels(screen: RenderResult) {
  return screen.queryAllByRole("option", {
    hidden: true
  }).map(option => option.textContent);
}

// jsdom has no modal dialogs; these stand in for showModal and close.
function modalDialogs() {
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    window.setTimeout(() => this.dispatchEvent(new window.Event("close")));
  };
}

// A transaction row in miniature: the picker shows the categories query and assigns what it reports.
async function renderPicker(context: TestContext) {
  const environment = browser(context);

  modalDialogs();

  const { CategoryPicker } = await import("../src/features/categorization/components/category-picker");
  const { useCategories } = await import("../src/features/categorization/queries");
  const assigned: (string | null)[] = [];

  function Row() {
    const categories = useCategories();
    const [value, setValue] = useState<string | null>(null);

    return createElement(CategoryPicker, {
      "aria-label": "Category",
      categories: categories.data ?? [],
      value,
      includeUncategorized: true,
      onChange: (next: string | null) => {
        assigned.push(next);
        setValue(next);
      }
    });
  }

  const screen = render(withQueryClient(environment.queryClient, createElement(Row)));

  await wait(0);
  await respond(environment.requests("categories")[0], Response.json([groceries]));

  return {
    ...environment,
    assigned,
    screen
  };
}

test("the create option appears only without an exact match, ignoring case, and is reachable with the keyboard", async context => {
  const {
    assigned,
    screen
  } = await renderPicker(context);
  const field = categoryField(screen);

  type(field, "  groceries ");
  assert.deepEqual(optionLabels(screen), ["Groceries"]);

  type(field, "Groc");
  assert.deepEqual(optionLabels(screen), ["Groceries", "Create category “Groc”"]);
  assert.match(screen.getByRole("status").textContent ?? "", /Create category “Groc” is available\./);

  // The first match is highlighted; the create option is the last one and Enter there opens the dialog instead of assigning.
  press(field, "ArrowDown");
  assert.equal(field.getAttribute("aria-activedescendant"), screen.getByRole("option", {
    name: "Create category “Groc”",
    hidden: true
  }).id);
  press(field, "Enter");

  assert.deepEqual(assigned, []);
  assert.equal(screen.getByRole("dialog", {
    name: "Add category"
  }).hasAttribute("open"), true);
  assert.equal((screen.getByRole("textbox", {
    name: "Name"
  }) as HTMLInputElement).value, "Groc");
});

test("a created category is selected in the picker that started it, and cancelling keeps the selection", async context => {
  const {
    assigned,
    requests,
    screen
  } = await renderPicker(context);
  const field = categoryField(screen);

  type(field, "Pets");
  // Without matches, the create option is the only one and already highlighted.
  press(field, "Enter");
  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Close dialog"
    }));
  });
  await wait(1);

  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(assigned, []);

  type(field, "");
  type(field, "Pets");
  press(field, "Enter");
  act(() => {
    fireEvent.submit(screen.getByRole("textbox", {
      name: "Name"
    }).closest("form")!);
  });
  await wait(0);

  const created = requests("categories").find(request => request.method === "POST");

  const {
    color,
    ...details
  } = created?.body as {
    color: string;
  };

  // The name suggests the pets icon, which a new category takes until another one is chosen.
  assert.deepEqual(details, {
    name: "Pets",
    icon: "pets"
  });
  // A new category starts with a randomly chosen palette color.
  assert.ok(suggestedCategoryColors.some(suggestion => suggestion.value === color));
  await respond(created, Response.json({
    ok: true,
    id: "pets"
  }, {
    status: 201
  }));
  // The dialog closes once the refreshed categories include the new one, which the picker then assigns and shows.
  await respond(requests("categories").filter(request => request.method === "GET")[1], Response.json([groceries, {
    ...groceries,
    id: "pets",
    name: "Pets"
  }]));

  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(assigned, ["pets"]);
  assert.equal(field.value, "Pets");
});
