import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement, useState } from "react";
import type { Category } from "../src/features/categorization/types";
import type { CategorySelection, CategoryValue } from "../src/features/imports/import-plan";
import type { ImportDraft } from "../src/features/imports/components/use-import-draft";
import { browser, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const groceries: Category = {
  id: "groceries",
  name: "Groceries",
  color: "#638777",
  icon: null
};

function value(name: string): CategoryValue {
  return {
    value: name,
    rows: 1,
    multiTag: false,
    matchId: null
  };
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

function chooseOption(screen: RenderResult, field: HTMLInputElement, search: string, name: string) {
  type(field, search);
  act(() => {
    fireEvent.click(screen.getByRole("option", {
      name,
      hidden: true
    }));
  });
}

// The import page's category section with only the draft state it reads; selections resolve like the page's unset defaults.
async function renderChoices(context: TestContext) {
  const environment = browser(context);
  const { CategoryChoices } = await import("../src/features/imports/components/category-choices");
  const values = [value("Hobby"), value("Model kits"), value("Lebensmittel"), value("Food, Travel")];
  let latest = new Map<string, CategorySelection>();

  function Page() {
    const [chosen, setChosen] = useState(new Map<string, CategorySelection>());
    const categories = new Map(values.map(item => [item.value, chosen.get(item.value) ?? {
      action: "unset"
    } satisfies CategorySelection]));

    latest = categories;

    const draft = {
      categoryValues: values,
      categories,
      categoryOptions: [groceries],
      inputsLocked: false,
      prepared: null,
      chooseCategory: (name: string, selection: CategorySelection) => setChosen(current => new Map(current).set(name, selection))
    } as unknown as ImportDraft;

    return createElement(CategoryChoices, {
      draft
    });
  }

  const screen = render(withQueryClient(environment.queryClient, createElement(Page)));
  const fields = screen.getAllByRole("combobox") as HTMLInputElement[];

  return {
    ...environment,
    screen,
    fields,
    selections: () => latest
  };
}

test("the import maps values with the category picker and only records new categories until the import is confirmed", async context => {
  const {
    screen,
    fields,
    requests,
    selections
  } = await renderChoices(context);
  const [hobby, modelKits, lebensmittel, foodTravel] = fields;

  // Creating from a search records a pending category instead of opening the category dialog or saving anything.
  type(hobby, "Hobbies");
  press(hobby, "Enter");
  await wait(0);

  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(requests("categories").filter(request => request.method === "POST"), []);

  const pending = selections().get("Hobby");

  assert.equal(pending?.action, "create");
  assert.equal(pending.action === "create" && pending.category.name, "Hobbies");
  assert.equal(pending.action === "create" && pending.category.icon, "hobbies");
  assert.equal(hobby.value, "Hobbies");

  // The pending category is offered to the other values like an existing one.
  chooseOption(screen, modelKits, "Hobb", "Hobbies");
  chooseOption(screen, lebensmittel, "Groc", "Groceries");
  chooseOption(screen, foodTravel, "Unc", "Uncategorized");
  await wait(0);

  assert.deepEqual(selections().get("Model kits"), pending);
  assert.deepEqual(selections().get("Lebensmittel"), {
    action: "existing",
    categoryId: "groceries"
  });
  assert.deepEqual(selections().get("Food, Travel"), {
    action: "uncategorized"
  });
  assert.deepEqual(requests("categories").filter(request => request.method === "POST"), []);
});
