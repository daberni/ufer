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
import { randomCategoryColor, suggestCategoryColor, type ColoredCategory } from "../src/features/categorization/category-color-suggestions";
import { suggestedCategoryColors } from "../src/features/categorization/category-colors";
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

test("there is no suggestion when nothing similar exists or similar categories use custom colors", () => {
  const others = [category("rent", "Rent", "rent", terracotta), category("gym", "Gym / Fees", null, "#123456")];

  assert.equal(suggestCategoryColor("Misc", null, others), null);
  assert.equal(suggestCategoryColor("Salary", "salary", others), null);
  // Two plain names are not a prefix group.
  assert.equal(suggestCategoryColor("Rent", null, [category("rent2", "Rent", null, terracotta)]), null);
  assert.equal(suggestCategoryColor("Gym / Classes", null, others), null);
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
