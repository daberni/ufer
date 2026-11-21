import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement } from "react";
import { initializeDatabase } from "../src/server/database/migrations";
import * as schema from "../src/server/database/schema";
import type { Database } from "../src/server/database/connection";
import { readPayeeSuggestions, suggestPayees } from "../src/features/transactions/server/payee-suggestions";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

function usage(payee: string, uses: number, last_booking_date = "2026-01-01") {
  return {
    payee,
    uses,
    last_booking_date
  };
}

test("suggestions match the start of the payee or of its words, ignoring case and accents", () => {
  const usages = [usage("Müller Bäckerei", 1), usage("SPAR Filiale", 1), usage("Hausverwaltung Mayr", 1), usage("Example-Store", 1)];

  assert.deepEqual(suggestPayees(usages, "mull"), ["Müller Bäckerei"]);
  assert.deepEqual(suggestPayees(usages, "baeck"), []);
  assert.deepEqual(suggestPayees(usages, "BACK"), ["Müller Bäckerei"]);
  assert.deepEqual(suggestPayees(usages, "fil sp"), ["SPAR Filiale"]);
  assert.deepEqual(suggestPayees(usages, "store"), ["Example-Store"]);
  // Inside a word is not a match.
  assert.deepEqual(suggestPayees(usages, "verwaltung"), []);
  assert.deepEqual(suggestPayees(usages, "  "), []);
});

test("suggestions match words after any punctuation in a payee", () => {
  const usages = [usage("SQ *MARKET STALL 0412", 1), usage("Shop#Corner_Kiosk", 1)];

  assert.deepEqual(suggestPayees(usages, "market"), ["SQ *MARKET STALL 0412"]);
  assert.deepEqual(suggestPayees(usages, "0412"), ["SQ *MARKET STALL 0412"]);
  assert.deepEqual(suggestPayees(usages, "corner kiosk"), ["Shop#Corner_Kiosk"]);
});

test("suggestions rank frequent payees first, then recent ones, and leave out the exact typed text", () => {
  const usages = [usage("Bakery old", 2, "2025-01-01"), usage("Bakery new", 2, "2026-03-01"), usage("Bakery", 1, "2026-05-01"), usage("Bakery frequent", 9, "2024-01-01")];

  assert.deepEqual(suggestPayees(usages, "bak"), ["Bakery frequent", "Bakery new", "Bakery old", "Bakery"]);
  assert.deepEqual(suggestPayees(usages, "Bakery"), ["Bakery frequent", "Bakery new", "Bakery old"]);
});

test("suggestions are limited to a short list", () => {
  const usages = Array.from({
    length: 20
  }, (_, index) => usage(`Shop ${index}`, 20 - index));

  assert.deepEqual(suggestPayees(usages, "shop"), ["Shop 0", "Shop 1", "Shop 2", "Shop 3", "Shop 4", "Shop 5", "Shop 6", "Shop 7"]);
});

async function seedPayees(context: TestContext) {
  const client = createClient({
    url: ":memory:"
  });
  const globals = globalThis as unknown as {
    budgetDb?: Promise<Database>
  };
  const previousDatabase = globals.budgetDb;
  const previousEnvironment = process.env.ENABLE_BANKING_ENVIRONMENT;

  context.after(() => {
    globals.budgetDb = previousDatabase;

    if (previousEnvironment === undefined) {
      delete process.env.ENABLE_BANKING_ENVIRONMENT;
    } else {
      process.env.ENABLE_BANKING_ENVIRONMENT = previousEnvironment;
    }

    client.close();
  });

  await initializeDatabase(client);
  const db = drizzle(client, {
    schema
  });

  globals.budgetDb = Promise.resolve(db);
  process.env.ENABLE_BANKING_ENVIRONMENT = "SANDBOX";
  await db.insert(schema.accounts).values([{
    id: "sandbox-checking",
    name: "Synthetic checking",
    institution: "Example institution",
    kind: "checking"
  }]);

  const bookings: [string, string, string | null, string | null][] = [
    ["sandbox-checking", "CORNER BAKERY 0815", "Corner Bakery", null],
    ["sandbox-checking", "CORNER BAKERY 0816", "Corner Bakery", null],
    ["sandbox-checking", "Corner Bakery", null, null],
    ["sandbox-checking", "Corner Bakery Hidden", null, "2026-02-01T00:00:00Z"],
    ["sandbox-checking", "Corner Shop", null, null]
  ];

  await db.insert(schema.transactions).values(bookings.map(([account_id, counterparty, counterparty_override, suppressed_at], index) => ({
    id: `booking-${index}`,
    account_id,
    provider_reference: `synthetic-${index}`,
    booking_date: `2026-01-1${index}`,
    amount_minor: -1000,
    currency: "EUR",
    type: "expense" as const,
    counterparty,
    counterparty_override,
    suppressed_at
  })));
}

test("suggestions use the payee override over the source's payee and skip hidden bookings", async context => {
  await seedPayees(context);

  const suggestions = await readPayeeSuggestions({
    query: "corner"
  });

  assert.deepEqual(suggestions.payees, ["Corner Bakery", "Corner Shop"]);
});

function type(field: HTMLInputElement, value: string) {
  act(() => {
    fireEvent.change(field, {
      target: {
        value
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

function options(screen: RenderResult) {
  return screen.getAllByRole("option", {
    hidden: true
  });
}

async function renderPayeeInput(context: TestContext, defaultValue?: string) {
  const environment = browser(context);

  // jsdom has no popover API; showing and hiding the list is layout only, and role queries treat its content as hidden.
  window.HTMLElement.prototype.showPopover = function () {};

  window.HTMLElement.prototype.hidePopover = function () {};

  const { PayeeInput } = await import("../src/features/transactions/components/payee-input");
  const submitted: string[] = [];
  const screen = render(withQueryClient(environment.queryClient, createElement("form", {
    onSubmit: (event: {
      preventDefault: () => void;
      currentTarget: HTMLFormElement
    }) => {
      event.preventDefault();
      submitted.push(String(new FormData(event.currentTarget).get("counterparty")));
    }
  }, createElement(PayeeInput, {
    label: "Payee",
    name: "counterparty",
    maxLength: 500,
    defaultValue
  }))));
  const field = screen.getByRole("combobox", {
    name: "Payee"
  }) as HTMLInputElement;

  return {
    ...environment,
    screen,
    field,
    submitted
  };
}

test("typing asks for suggestions in the request body once typing pauses, and Enter on a highlighted suggestion fills the field", async context => {
  const {
    field,
    requests,
    screen,
    submitted
  } = await renderPayeeInput(context);

  type(field, "co");
  await wait(100);
  type(field, "cor");
  await wait(300);

  const sent = requests("transactions/payees");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "POST");
  assert.equal(sent[0].url.search, "");
  assert.deepEqual(sent[0].body, {
    query: "cor"
  });

  await respond(sent[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(options(screen).length, 2);

  press(field, "ArrowDown");
  press(field, "ArrowDown");
  assert.equal(field.getAttribute("aria-activedescendant"), options(screen)[1].id);

  press(field, "Enter");

  assert.equal(field.value, "Corner Shop");
  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.deepEqual(submitted, []);

  // Without a highlighted suggestion, Enter submits the form with the field's free text.
  type(field, "Corner Shop Vienna");
  await act(async () => {
    field.form?.requestSubmit();
  });
  assert.deepEqual(submitted, ["Corner Shop Vienna"]);
});

test("Enter with suggestions shown but none highlighted closes the list and lets the form submit the typed text", async context => {
  const {
    field,
    requests
  } = await renderPayeeInput(context);

  type(field, "cor");
  await wait(300);
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery"]
  }));
  assert.equal(field.getAttribute("aria-expanded"), "true");

  let notPrevented = false;

  act(() => {
    notPrevented = fireEvent.keyDown(field, {
      key: "Enter"
    });
  });

  // An unprevented Enter is what makes the browser submit the surrounding form.
  assert.equal(notPrevented, true);
  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.equal(field.value, "cor");
});

test("ArrowDown after Escape reopens the suggestions on the first one, and Enter picks it", async context => {
  const {
    field,
    requests,
    screen
  } = await renderPayeeInput(context);

  type(field, "cor");
  await wait(300);
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  press(field, "Escape");
  assert.equal(field.getAttribute("aria-expanded"), "false");

  press(field, "ArrowDown");
  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(field.getAttribute("aria-activedescendant"), options(screen)[0].id);

  press(field, "Enter");
  assert.equal(field.value, "Corner Bakery");
});

test("ArrowDown in a prefilled field highlights the first suggestion once it arrives, and Enter picks it instead of submitting", async context => {
  const {
    field,
    requests,
    screen,
    submitted
  } = await renderPayeeInput(context, "cor");

  press(field, "ArrowDown");
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(field.getAttribute("aria-activedescendant"), options(screen)[0].id);

  press(field, "Enter");
  assert.equal(field.value, "Corner Bakery");
  assert.deepEqual(submitted, []);
});

test("ArrowUp in a prefilled field highlights the last suggestion once it arrives", async context => {
  const {
    field,
    requests,
    screen
  } = await renderPayeeInput(context, "cor");

  press(field, "ArrowUp");
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  assert.equal(field.getAttribute("aria-activedescendant"), options(screen)[1].id);

  press(field, "Enter");
  assert.equal(field.value, "Corner Shop");
});

test("Escape while suggestions are still loading keeps the list closed when they arrive", async context => {
  const {
    field,
    requests
  } = await renderPayeeInput(context, "cor");

  press(field, "ArrowDown");
  press(field, "Escape");
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.equal(field.value, "cor");
});

test("a press outside while suggestions are still loading keeps the list closed when they arrive", async context => {
  const {
    field,
    requests
  } = await renderPayeeInput(context, "cor");

  press(field, "ArrowDown");
  act(() => {
    fireEvent.pointerDown(document.body);
  });
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  assert.equal(field.getAttribute("aria-expanded"), "false");
});

test("Alt+ArrowDown in a prefilled field opens the suggestions without highlighting one", async context => {
  const {
    field,
    requests
  } = await renderPayeeInput(context, "cor");

  act(() => {
    fireEvent.keyDown(field, {
      key: "ArrowDown",
      altKey: true
    });
  });
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  assert.equal(field.getAttribute("aria-expanded"), "true");
  assert.equal(field.getAttribute("aria-activedescendant"), null);
});

test("a pointer picks a suggestion and Escape closes the list without clearing the text", async context => {
  const {
    field,
    requests,
    screen
  } = await renderPayeeInput(context);

  type(field, "cor");
  await wait(300);
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery", "Corner Shop"]
  }));

  press(field, "Escape");
  assert.equal(field.getAttribute("aria-expanded"), "false");
  assert.equal(field.value, "cor");

  type(field, "corn");
  await wait(300);
  await respond(requests("transactions/payees")[1], Response.json({
    payees: ["Corner Bakery"]
  }));

  fireEvent.click(screen.getByRole("option", {
    name: "Corner Bakery",
    hidden: true
  }));

  assert.equal(field.value, "Corner Bakery");
  assert.equal(field.getAttribute("aria-expanded"), "false");
});

test("suggestions for earlier text disappear as soon as the text changes, until those for the new text arrive", async context => {
  const {
    field,
    requests,
    screen
  } = await renderPayeeInput(context);

  type(field, "cor");
  await wait(300);
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Corner Bakery"]
  }));
  assert.equal(options(screen).length, 1);

  type(field, "bak");
  assert.equal(field.getAttribute("aria-expanded"), "false");
  press(field, "ArrowDown");
  press(field, "Enter");
  assert.equal(field.value, "bak");

  await wait(300);
  assert.equal(field.getAttribute("aria-expanded"), "false");
  await respond(requests("transactions/payees")[1], Response.json({
    payees: ["Bakery Example"]
  }));
  assert.deepEqual(options(screen).map(option => option.textContent), ["Bakery Example"]);
});

test("the highlighted suggestion scrolls into view in a scrolling list", async context => {
  const {
    field,
    requests
  } = await renderPayeeInput(context);
  const scrolled: (string | null)[] = [];

  window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.textContent);
  };

  type(field, "shop");
  await wait(300);
  await respond(requests("transactions/payees")[0], Response.json({
    payees: ["Shop A", "Shop B", "Shop C"]
  }));

  press(field, "ArrowUp");
  assert.equal(scrolled.at(-1), "Shop C");
});
