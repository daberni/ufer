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
import { suggestCategoryColors, suggestNewCategoryColor, type ColoredCategory } from "../src/features/categorization/category-color-suggestions";
import { applyCategoryColors } from "../src/features/categorization/server/category-color-service";
import { createCategory } from "../src/features/categorization/server/categorization-service";
import { HttpError, ValidationError } from "../src/lib/errors";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const terracotta = "#B85C38";
const brown = "#90674D";
const ocean = "#2A74B0";
const teal = "#1D8A80";
const crimson = "#C2413B";
const forest = "#33805A";
const sage = "#638777";

function category(id: string, name: string, icon: string | null, color = "#617385"): ColoredCategory {
  return {
    id,
    name,
    color,
    icon
  };
}

function suggestionsById(categories: ColoredCategory[]) {
  return Object.fromEntries(suggestCategoryColors(categories).map(suggestion => [suggestion.category.id, suggestion.suggested]));
}

test("a new category takes the color its prefix siblings share, even against its icon", () => {
  const existing = [category("fuel", "Car / Fuel", "fuel", "#123456"), category("tolls", "Car / Tolls", "tolls", "#123456"), category("rent", "Rent", "rent", "#654321")];

  assert.equal(suggestNewCategoryColor("Car / Parking", "groceries", existing), "#123456");
  assert.equal(suggestNewCategoryColor("car / Wash", null, existing), "#123456");
  // A plain name joins the prefix group it names.
  assert.equal(suggestNewCategoryColor("Car", null, existing), "#123456");
});

test("without prefix siblings the icon's area decides, and without an icon the default color", () => {
  const existing = [category("rent", "Rent", "rent", "#654321")];

  assert.equal(suggestNewCategoryColor("Flat / Deposit", "housing", existing), terracotta);
  assert.equal(suggestNewCategoryColor("Salary", "salary", existing), forest);
  assert.equal(suggestNewCategoryColor("Speeding ticket", "fines", existing), crimson);
  assert.equal(suggestNewCategoryColor("Misc", null, existing), sage);
});

test("prefix groups share one color, keep their area family and stay distinct from groups of the same area", () => {
  const categories = [
    category("rent", "Home / Rent", "rent"),
    category("power", "Home / Power", "electricity"),
    category("garden", "Cottage / Garden", "garden"),
    category("cottage", "Cottage / Repairs", "repairs"),
    category("fuel", "Car / Fuel", "fuel"),
    category("ticket", "Car / Fines", "fines"),
    category("hotel", "Vacation / Hotel", "hotel"),
    category("trip", "Vacation / Sightseeing", "sightseeing"),
    category("pay", "Salary", "salary")
  ];
  const suggested = suggestionsById(categories);

  assert.equal(suggested.rent, suggested.power);
  assert.equal(suggested.garden, suggested.cottage);
  // Groups are assigned in name order: "Cottage" takes the first home color, "Home" the next.
  assert.equal(suggested.cottage, terracotta);
  assert.equal(suggested.rent, brown);
  assert.equal(suggested.fuel, ocean);
  assert.equal(suggested.ticket, crimson);
  assert.equal(suggested.hotel, teal);
  assert.equal(suggested.pay, forest);
});

test("suggestions do not depend on the order of the categories and report unchanged colors", () => {
  const categories = [
    category("a", "Home / Rent", "rent", terracotta.toLowerCase()),
    category("b", "Cottage / Garden", "garden"),
    category("c", "Cottage", null),
    category("d", "Home / Internet", "internet")
  ];
  const forward = suggestCategoryColors(categories);
  const reversed = suggestCategoryColors([...categories].reverse());

  assert.deepEqual(suggestionsById(categories), suggestionsById([...categories].reverse()));
  assert.deepEqual(forward.map(entry => entry.category.id), ["a", "b", "c", "d"]);
  assert.deepEqual(reversed.map(entry => entry.category.id), ["d", "c", "b", "a"]);
  assert.equal(forward.find(entry => entry.category.id === "b")?.changed, true);
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

async function storedColors(db: Database) {
  const rows = await db.select().from(schema.categories);

  return Object.fromEntries(rows.filter(row => row.name.startsWith("Car / ")).map(row => [row.name, row.color]));
}

test("the batch update stores palette colors in one transaction and rejects anything else without changes", async context => {
  const db = await isolatedDatabase(context);
  const fuel = await createCategory({
    name: "Car / Fuel",
    color: "#617385"
  });
  const tolls = await createCategory({
    name: "Car / Tolls",
    color: "#617385"
  });
  const before = await storedColors(db);

  await assert.rejects(applyCategoryColors({
    colors: [{
      id: fuel.id,
      color: "#123456"
    }]
  }), ValidationError);
  await assert.rejects(applyCategoryColors({
    colors: [{
      id: fuel.id,
      color: ocean
    }, {
      id: fuel.id,
      color: teal
    }]
  }), ValidationError);
  await assert.rejects(applyCategoryColors({
    colors: [{
      id: fuel.id,
      color: ocean
    }, {
      id: "missing",
      color: ocean
    }]
  }), (error: unknown) => error instanceof HttpError && error.status === 404);
  await assert.rejects(applyCategoryColors({
    colors: [{
      id: fuel.id,
      color: "blue"
    }]
  }));
  assert.deepEqual(await storedColors(db), before);

  const result = await applyCategoryColors({
    colors: [{
      id: fuel.id,
      color: ocean
    }, {
      id: tolls.id,
      color: ocean.toLowerCase()
    }]
  });

  assert.deepEqual(result, {
    ok: true,
    updated: 2
  });
  assert.deepEqual(await storedColors(db), {
    "Car / Fuel": ocean.toLowerCase(),
    "Car / Tolls": ocean.toLowerCase()
  });
});

test("the suggestion dialog applies only the checked changes, in one request, after confirmation", async context => {
  const environment = browser(context);
  const prototype = window.HTMLDialogElement.prototype;

  prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const { CategoryColorSuggestionsDialog } = await import("../src/features/categorization/components/category-color-suggestions-dialog");
  const categories = [
    category("fuel", "Car / Fuel", "fuel"),
    category("tolls", "Car / Tolls", "tolls"),
    category("pay", "Salary", "salary", forest.toLowerCase())
  ];
  let closed = 0;
  const screen = render(withQueryClient(environment.queryClient, createElement(CategoryColorSuggestionsDialog, {
    categories,
    close: () => {
      closed += 1;
    }
  })));

  // Salary already has its suggestion and is not listed.
  assert.deepEqual(screen.getAllByRole("checkbox").map(box => box.closest("label")?.textContent?.includes("Car /")), [true, true]);
  assert.equal(environment.requests("categories").length, 0);

  act(() => {
    fireEvent.click(screen.getByRole("checkbox", {
      name: /Car \/ Tolls/
    }));
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Apply 1 color"
    }));
  });
  await wait(0);

  const [request] = environment.requests("categories");

  assert.equal(request.method, "PATCH");
  assert.deepEqual(request.body, {
    colors: [{
      id: "fuel",
      color: ocean
    }]
  });

  await respond(request, Response.json({
    ok: true,
    updated: 1
  }));
  await wait(0);
  assert.equal(closed, 1);
});

test("a new category preselects its prefix color until the person chooses another one", async context => {
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

  const name = screen.getByRole("textbox", {
    name: "Name"
  });
  const color = () => (screen.container.ownerDocument.querySelector("input[name='color']") as HTMLInputElement).value;

  assert.equal(color(), sage);

  act(() => {
    fireEvent.change(name, {
      target: {
        value: "Car / Parking"
      }
    });
  });
  assert.equal(color(), "#123456");

  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Suggested colors"
    }));
  });

  const swatches = screen.getAllByRole("radio", {
    hidden: true
  });

  // The palette has no #123456, so nothing is marked as the suggestion; choosing a swatch overrides it for good.
  assert.equal(swatches.some(swatch => swatch.getAttribute("aria-label")?.includes("(suggested)")), false);
  act(() => {
    fireEvent.click(screen.getByRole("radio", {
      name: "Teal",
      hidden: true
    }));
  });
  act(() => {
    fireEvent.change(name, {
      target: {
        value: "Car / Wash"
      }
    });
  });
  assert.equal(color(), teal);
});

test("a category without a prefix group or an icon keeps its color", () => {
  const [suggestion] = suggestCategoryColors([category("misc", "Miscellaneous", null, "#d08a4f")]);

  assert.equal(suggestion.suggested, "#D08A4F");
  assert.equal(suggestion.changed, false);
});
