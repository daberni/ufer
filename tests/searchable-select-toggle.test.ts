import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, type RenderResult } from "@testing-library/react";
import { render } from "./fixtures/intl";
import { createElement, useState } from "react";
import { browser } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const fruits = ["Apple", "Banana", "Cherry"].map(label => ({
  key: label,
  value: label,
  label
}));

// A field showing its selected option, as a category picker in a transaction row does.
async function renderSelect(context: TestContext) {
  browser(context);

  const { SearchableSelect } = await import("../src/components/ui/searchable-select");
  const chosen: string[] = [];

  function Field() {
    const [value, setValue] = useState("Banana");
    const [search, setSearch] = useState("");

    return createElement(SearchableSelect<string>, {
      id: "fruit",
      "aria-label": "Fruit",
      options: fruits,
      value,
      query: search,
      onQueryChange: setSearch,
      onChange: next => {
        chosen.push(next);
        setValue(next);
      },
      noun: "category",
      placeholder: "Search fruits"
    });
  }

  const screen = render(createElement(Field));

  return {
    chosen,
    screen,
    field: screen.getByRole("combobox", {
      name: "Fruit"
    }) as HTMLInputElement,
    toggle: screen.getByRole("button", {
      name: "Show categories"
    })
  };
}

function press(element: HTMLElement, key: string) {
  act(() => {
    fireEvent.keyDown(element, {
      key
    });
  });
}

function activeOption(screen: RenderResult) {
  return screen.queryAllByRole("option", {
    hidden: true
  }).find(option => option.hasAttribute("data-active"))?.textContent;
}

function announcement(screen: RenderResult) {
  return screen.getByRole("status").textContent;
}

test("the toggle opens the list on the selected option without focusing the search field", async context => {
  const {
    screen,
    field,
    toggle
  } = await renderSelect(context);

  assert.equal(toggle.getAttribute("aria-haspopup"), "listbox");
  assert.equal(toggle.getAttribute("aria-controls"), field.getAttribute("aria-controls"));

  act(() => {
    fireEvent.click(toggle);
  });

  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, toggle);
  assert.notEqual(document.activeElement, field);
  assert.equal(activeOption(screen), "Banana");
  assert.equal(announcement(screen), "Banana, selected, 2 of 3");
});

test("from the toggle, arrow keys move through the options, Enter picks one and Escape closes the list while the toggle keeps focus", async context => {
  const {
    chosen,
    screen,
    field,
    toggle
  } = await renderSelect(context);

  act(() => {
    toggle.focus();
  });
  press(toggle, "ArrowDown");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(activeOption(screen), "Banana");

  press(toggle, "ArrowDown");
  assert.equal(activeOption(screen), "Cherry");
  assert.equal(announcement(screen), "Cherry, 3 of 3");

  press(toggle, "Enter");
  assert.deepEqual(chosen, ["Cherry"]);
  assert.equal(field.value, "Cherry");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, toggle);

  press(toggle, " ");
  assert.equal(activeOption(screen), "Cherry");
  press(toggle, "ArrowUp");
  press(toggle, " ");
  assert.deepEqual(chosen, ["Cherry", "Banana"]);

  press(toggle, "Enter");
  press(toggle, "Escape");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, toggle);
  assert.deepEqual(chosen, ["Cherry", "Banana"]);
});

for (const [browserName, focusesButton] of [["browsers that focus a pressed button", true], ["Safari, which does not focus a pressed button", false]] as const) {
  test(`the toggle closes a list that the search field opened, in ${browserName}`, async context => {
    const {
      field,
      toggle
    } = await renderSelect(context);

    act(() => {
      field.focus();
      fireEvent.click(field);
    });
    assert.equal(field.getAttribute("aria-expanded"), "true");

    // A press first reaches the toggle, then the field loses focus and the page renders, and only then the click follows.
    act(() => {
      fireEvent.pointerDown(toggle);
    });
    act(() => {
      if (focusesButton) {
        toggle.focus();
      } else {
        field.blur();
      }
    });
    act(() => {
      fireEvent.click(toggle);
    });

    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  });
}

test("typing on the toggle moves focus to the search field and searches for the typed character", async context => {
  const {
    screen,
    field,
    toggle
  } = await renderSelect(context);

  act(() => {
    fireEvent.click(toggle);
  });
  press(toggle, "c");

  assert.equal(document.activeElement, field);
  assert.equal(field.value, "c");
  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(activeOption(screen), "Cherry");
  assert.equal(field.getAttribute("aria-activedescendant"), screen.getByRole("option", {
    name: "Cherry",
    hidden: true
  }).id);
});

test("focusing the field empties it and shows the selection as its placeholder, and leaving it shows the selection again", async context => {
  const {
    field
  } = await renderSelect(context);

  assert.equal(field.value, "Banana");

  act(() => {
    field.focus();
    fireEvent.click(field);
  });
  assert.equal(field.value, "");
  assert.equal(field.placeholder, "Banana");

  act(() => {
    fireEvent.change(field, {
      target: {
        value: "ch"
      }
    });
  });
  act(() => {
    field.blur();
  });

  assert.equal(field.value, "Banana");
  assert.equal(field.getAttribute("aria-expanded"), "false");
});

test("the first Escape drops the search and returns to the selected option, the second closes the list", async context => {
  const {
    chosen,
    screen,
    field
  } = await renderSelect(context);

  act(() => {
    field.focus();
    fireEvent.click(field);
  });
  act(() => {
    fireEvent.change(field, {
      target: {
        value: "ch"
      }
    });
  });
  assert.equal(activeOption(screen), "Cherry");

  press(field, "Escape");
  assert.equal(field.value, "");
  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(activeOption(screen), "Banana");

  press(field, "Escape");
  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, field);
  assert.deepEqual(chosen, []);
});
