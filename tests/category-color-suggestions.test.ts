import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Database } from "../src/server/database/connection";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import { newCategoryColor, randomCategoryColor, suggestCategoryColor, type ColoredCategory } from "../src/features/categorization/category-color-suggestions";
import { suggestedCategoryColors } from "../src/features/categorization/category-colors";
import { suggestCategoryIcon } from "../src/features/categorization/category-icons";
import { createCategory } from "../src/features/categorization/server/categorization-service";
import { createImportCategory } from "../src/features/imports/server/mapped-import-repository";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const palette = suggestedCategoryColors.map(color => color.value);
const ocean = "#2A74B0";
const teal = "#1D8A80";
const terracotta = "#B85C38";

function category(id: string, name: string, icon: string | null, color: string): ColoredCategory {
  return {
    id,
    name,
    color,
    icon
  };
}

test("similar categories by name prefix decide the suggestion before the icon's area", () => {
  const others = [category("fuel", "Car / Fuel", "fuel", ocean), category("tolls", "Car / Tolls", "tolls", ocean), category("rent", "Rent", "rent", terracotta)];

  assert.equal(suggestCategoryColor("Car / Parking", "groceries", others), ocean);
  assert.equal(suggestCategoryColor("car", null, others), ocean);
  // Without prefix siblings, a category whose icon is in the same area decides.
  assert.equal(suggestCategoryColor("Flat deposit", "housing", others), terracotta);
});

test("there is no suggestion when nothing similar exists", () => {
  const others = [category("rent", "Rent", "rent", terracotta)];

  assert.equal(suggestCategoryColor("Misc", null, others), null);
  assert.equal(suggestCategoryColor("Salary", "salary", others), null);
  // Two plain names are not a prefix group.
  assert.equal(suggestCategoryColor("Rent", null, [category("rent2", "Rent", null, terracotta)]), null);
});

test("custom colors of similar categories count like palette colors", () => {
  const others = [category("gym", "Gym / Fees", null, "#123abc"), category("classes", "Gym / Classes", null, "#123ABC"), category("shoes", "Gym / Shoes", null, ocean)];

  assert.equal(suggestCategoryColor("Gym / Towels", null, others), "#123ABC");
});

test("a new category takes the similar categories' color and only otherwise a random least used one", () => {
  const existing = [category("fuel", "Car / Fuel", "fuel", "#123456")];

  assert.equal(newCategoryColor("Car / Wash", null, existing, () => 0), "#123456");

  const unrelated = newCategoryColor("Pets", null, existing, () => 0);

  assert.ok(palette.includes(unrelated));
});

test("random colors come only from the least used palette colors", () => {
  const used = palette.filter(color => color !== teal).concat(palette);

  // Every color but teal is used twice, teal once: whatever the random value, teal is chosen.
  assert.equal(randomCategoryColor(used, () => 0), teal);
  assert.equal(randomCategoryColor(used, () => 0.999), teal);
  // Custom colors and case do not matter.
  assert.equal(randomCategoryColor([...palette.map(color => color.toLowerCase()).filter(color => color !== ocean.toLowerCase()), "#123456"], () => 0.5), ocean);
});

async function isolatedDatabase(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;

  context.after(() => {
    globals.budgetDb = previousDatabase;
    client.close();
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);

  return db;
}

async function colorsOf(db: Database, prefix: string) {
  const rows = await db.select().from(schema.categories);

  return rows.filter(row => row.name.startsWith(prefix)).map(row => row.color);
}

test("categories created without a color get distinct palette colors until the palette is used up", async context => {
  const db = await isolatedDatabase(context);
  const existing = await colorsOf(db, "");

  for (let index = 0; index < palette.length; index++) {
    await createCategory({
      name: `Generated ${index}`
    });
  }

  const created = await colorsOf(db, "Generated ");
  const allColors = [...existing, ...created];
  const counts = palette.map(color => allColors.filter(used => used.toUpperCase() === color).length);

  assert.ok(created.every(color => palette.includes(color)));
  // Each new category took one of the least used colors, so usage never differs by more than one.
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `uneven usage ${counts.join()}`);
});

test("a category created by an import takes the palette color no other category uses", async context => {
  const db = await isolatedDatabase(context);

  await db.delete(schema.categories);
  await db.insert(schema.categories).values(palette.filter(color => color !== teal).map((color, index) => ({
    id: `seed-${index}`,
    name: `Seed ${index}`,
    color,
    icon: null
  })));

  await createImportCategory("Imported");
  assert.deepEqual(await colorsOf(db, "Imported"), [teal]);

  // A similar category's color wins over the unused palette color, custom or not.
  await db.insert(schema.categories).values({
    id: "fuel",
    name: "Car / Fuel",
    color: "#123456",
    icon: null
  });
  await createImportCategory("Car / Wash");
  await createCategory({
    name: "Car / Parking"
  });
  assert.deepEqual(await colorsOf(db, "Car / "), ["#123456", "#123456", "#123456"]);
});

test("the edit dialog highlights the similar categories' color and applies it with one click", async context => {
  const environment = browser(context);
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const parking = category("parking", "Car / Parking", null, terracotta);
  const { CategoryDialog } = await import("../src/features/categorization/components/category-form");
  const screen = render(withQueryClient(environment.queryClient, createElement(CategoryDialog, {
    category: parking,
    close: () => undefined
  })));

  await wait(0);
  await respond(environment.requests("categories")[0], Response.json([parking, category("fuel", "Car / Fuel", "fuel", ocean), category("rent", "Rent", "rent", teal)]));

  const color = () => (screen.container.ownerDocument.querySelector("input[name='color']") as HTMLInputElement).value;
  const suggestedSwatches = () => screen.queryAllByRole("radio", {
    hidden: true
  }).filter(swatch => swatch.getAttribute("aria-label")?.endsWith("(suggested)"));

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Suggested colors"
    }));
  });

  assert.deepEqual(suggestedSwatches().map(swatch => swatch.getAttribute("aria-label")), ["Ocean (suggested)"]);
  act(() => {
    fireEvent.click(suggestedSwatches()[0]);
  });
  assert.equal(color().toUpperCase(), ocean);
  // Once the category uses the suggestion, nothing is highlighted any more.
  assert.equal(suggestedSwatches().length, 0);

  act(() => {
    fireEvent.change(screen.getByRole("textbox", {
      name: "Name"
    }), {
      target: {
        value: "Parking"
      }
    });
  });
  act(() => {
    fireEvent.click(screen.getByRole("radio", {
      name: "Teal",
      hidden: true
    }));
  });
  // A plain name without an icon has no similar categories.
  assert.equal(suggestedSwatches().length, 0);
});

test("a custom similar color appears as an extra highlighted swatch, a new category follows it, and focusing the hex text opens the palette", async context => {
  const environment = browser(context);
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { CategoryDialog } = await import("../src/features/categorization/components/category-form");
  const screen = render(withQueryClient(environment.queryClient, createElement(CategoryDialog, {
    close: () => undefined
  })));

  await wait(0);
  await respond(environment.requests("categories")[0], Response.json([category("fuel", "Car / Fuel", "fuel", "#123456")]));

  const color = () => (screen.container.ownerDocument.querySelector("input[name='color']") as HTMLInputElement).value;

  assert.ok(palette.includes(color()));
  act(() => {
    fireEvent.change(screen.getByRole("textbox", {
      name: "Name"
    }), {
      target: {
        value: "Car / Wash"
      }
    });
  });
  assert.equal(color(), "#123456");

  const hex = screen.getByRole("textbox", {
    name: "Color"
  });

  act(() => {
    hex.focus();
  });
  assert.equal(screen.getByRole("button", {
    name: "Suggested colors"
  }).getAttribute("aria-expanded"), "true");
  // Focus stays in the text so typing continues.
  assert.equal(hex.ownerDocument.activeElement, hex);
  assert.equal(screen.getByRole("radio", {
    name: "Similar categories (suggested)",
    hidden: true
  }).getAttribute("aria-checked"), "true");
  // Leaving the unchanged text is no choice: the color keeps following the name.
  act(() => {
    hex.blur();
  });
  act(() => {
    fireEvent.change(screen.getByRole("textbox", {
      name: "Name"
    }), {
      target: {
        value: "Pets"
      }
    });
  });
  assert.ok(palette.includes(color()));
});

test("a new category's fallback color follows the categories that load after the dialog opened", async context => {
  const environment = browser(context);
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { CategoryDialog } = await import("../src/features/categorization/components/category-form");
  const screen = render(withQueryClient(environment.queryClient, createElement(CategoryDialog, {
    close: () => undefined
  })));
  const used = palette.filter(color => color !== teal).map((color, index) => category(`seed-${index}`, `Seed ${index}`, null, color));

  await wait(0);
  await respond(environment.requests("categories")[0], Response.json(used));

  assert.equal((screen.container.ownerDocument.querySelector("input[name='color']") as HTMLInputElement).value, teal);
});

test("the category name suggests an icon by its label or keywords, the part after the prefix first", () => {
  assert.equal(suggestCategoryIcon("Car / Fuel"), "fuel");
  assert.equal(suggestCategoryIcon("Car / Parking"), "parking");
  // Label words win over keywords, plurals and started words still match.
  assert.equal(suggestCategoryIcon("Pets"), "pets");
  assert.equal(suggestCategoryIcon("Groc"), "groceries");
  assert.equal(suggestCategoryIcon("Restaurant"), "dining");
  assert.equal(suggestCategoryIcon("Netflix"), "subscriptions");
  assert.equal(suggestCategoryIcon("Xyzzy"), null);
  // Words shorter than three letters never match.
  assert.equal(suggestCategoryIcon("TV"), null);
});

test("a new category waits for the categories before showing a color and follows the icon its name suggests until one is chosen", async context => {
  const environment = browser(context);
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { CategoryDialog } = await import("../src/features/categorization/components/category-form");
  const screen = render(withQueryClient(environment.queryClient, createElement(CategoryDialog, {
    close: () => undefined
  })));
  const document = screen.container.ownerDocument;
  const colorInput = () => document.querySelector("input[name='color']") as HTMLInputElement | null;
  const iconInput = () => (document.querySelector("input[name='icon']") as HTMLInputElement).value;

  await wait(0);
  // Until the categories arrive, no color is shown or submitted.
  assert.equal(colorInput(), null);
  assert.equal((screen.getByRole("textbox", {
    name: "Color"
  }) as HTMLInputElement).placeholder, "Loading…");

  await respond(environment.requests("categories")[0], Response.json([]));
  assert.ok(palette.includes(colorInput()!.value));

  const name = screen.getByRole("textbox", {
    name: "Name"
  });

  act(() => {
    fireEvent.change(name, {
      target: {
        value: "Groceries"
      }
    });
  });
  assert.equal(iconInput(), "groceries");

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Icon: Groceries"
    }));
  });
  assert.ok(screen.getByRole("option", {
    name: "Groceries (suggested)",
    hidden: true
  }));
  act(() => {
    fireEvent.click(screen.getByRole("option", {
      name: "Bakery",
      hidden: true
    }));
  });
  act(() => {
    fireEvent.change(name, {
      target: {
        value: "Pets"
      }
    });
  });
  // The chosen icon stays; the name's suggestion is only highlighted.
  assert.equal(iconInput(), "bakery");
});
