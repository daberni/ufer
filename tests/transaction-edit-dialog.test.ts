import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Transaction, TransferBooking, TransferOptions } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const outgoing: Transaction = {
  id: "out",
  booking_date: "2026-09-02",
  amount_minor: -35000,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: "Synthetic savings",
  description: "Standing order",
  source_counterparty: "Synthetic savings",
  source_description: "Standing order",
  hidden: false,
  account_name: "Synthetic checking",
  account_id: "synthetic-checking",
  category_id: null,
  category_source: "rule",
  category_rule_id: null,
  automatic_assignment: null,
  split: null,
  type: "expense",
  type_source: "auto",
  manual_account: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: null
};

function booking(id: string, accountName: string): TransferBooking {
  return {
    id,
    account_id: `${id}-account`,
    account_name: accountName,
    booking_date: "2026-09-02",
    amount_minor: 35000,
    currency: "EUR",
    counterparty: "Synthetic checking",
    description: "Standing order",
    created: false,
    entered: false
  };
}

async function renderDialog(context: TestContext, transaction: Transaction) {
  const browserEnvironment = browser(context);

  // jsdom has no modal dialogs.
  window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  const closed: boolean[] = [];
  const { TransactionEditDialog } = await import("../src/features/transactions/components/transaction-edit-dialog");
  const screen = render(withQueryClient(browserEnvironment.queryClient, createElement(TransactionEditDialog, {
    transaction,
    close: () => closed.push(true)
  })));

  await wait(0);

  return {
    ...browserEnvironment,
    screen,
    closed,
    save: () => screen.getByRole("button", {
      name: "Save"
    }) as HTMLButtonElement,
    target: () => screen.getByRole("combobox", {
      name: "Target account"
    }) as HTMLSelectElement
  };
}

test("a linked transfer cannot be saved before its target is known, and saving unchanged keeps the linked booking", async context => {
  const linked = {
    ...outgoing,
    type: "transfer" as const,
    counterpart: {
      id: "in",
      account_name: "Synthetic savings",
      booking_date: "2026-09-02"
    }
  };
  const {
    requests,
    save,
    screen,
    target
  } = await renderDialog(context, linked);

  assert.equal(save().disabled, true);
  await respond(requests("transactions/out/transfer")[0], Response.json({
    counterpart: booking("in", "Synthetic savings"),
    candidates: [],
    accounts: []
  } satisfies TransferOptions));

  assert.equal(save().disabled, false);
  assert.equal((screen.getByRole("radio", {
    name: /Synthetic savings/
  }) as HTMLInputElement).checked, true);
  assert.equal(target().selectedOptions[0].textContent, "Synthetic savings (selected booking)");

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "transfer",
    transfer: {
      counterpart_id: "in"
    }
  });
});

test("choosing a suggestion sets the target account, and a manual account or none replaces the suggestion", async context => {
  const {
    requests,
    save,
    screen,
    target
  } = await renderDialog(context, outgoing);

  assert.equal(requests("transactions/out/transfer").length, 0);
  act(() => {
    fireEvent.change(screen.getByRole("combobox", {
      name: "Type"
    }), {
      target: {
        value: "transfer"
      }
    });
  });
  await wait(0);
  await respond(requests("transactions/out/transfer")[0], Response.json({
    counterpart: null,
    candidates: [booking("candidate", "Synthetic savings")],
    accounts: [{
      id: "flat",
      name: "Synthetic flat"
    }]
  } satisfies TransferOptions));

  const suggestion = () => screen.getByRole("radio", {
    name: /Synthetic savings/
  }) as HTMLInputElement;

  assert.ok(screen.getByRole("group", {
    name: "Bookings on other accounts"
  }));
  assert.equal(target().value, "");

  act(() => {
    fireEvent.click(suggestion());
  });

  assert.equal(target().value, "booking:candidate");
  assert.ok(screen.getByText(/Linked with Synthetic savings/));

  act(() => {
    fireEvent.change(target(), {
      target: {
        value: "account:flat"
      }
    });
  });

  assert.equal(suggestion().checked, false);
  assert.ok(screen.getByText(/other side on Synthetic flat/));

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "transfer",
    transfer: {
      account_id: "flat"
    }
  });
});

test("a transfer without a target account is saved without a counterpart", async context => {
  const {
    requests,
    save,
    screen,
    target
  } = await renderDialog(context, {
    ...outgoing,
    type: "transfer"
  });

  await respond(requests("transactions/out/transfer")[0], Response.json({
    counterpart: null,
    candidates: [booking("candidate", "Synthetic savings")],
    accounts: []
  } satisfies TransferOptions));
  act(() => {
    fireEvent.click(screen.getByRole("radio", {
      name: /Synthetic savings/
    }));
  });
  act(() => {
    fireEvent.change(target(), {
      target: {
        value: ""
      }
    });
  });
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "transfer",
    transfer: null
  });
});

test("other types load no transfer options and send no target", async context => {
  const {
    requests,
    save
  } = await renderDialog(context, outgoing);

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.equal(requests("transactions/out/transfer").length, 0);
  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "expense"
  });
});

test("an imported booking sends only the changed payee, and restoring the bank's description drops its override", async context => {
  const overridden = {
    ...outgoing,
    description: "Rent reserve",
    source_description: "Standing order"
  };
  const {
    requests,
    save,
    screen
  } = await renderDialog(context, overridden);

  act(() => {
    fireEvent.change(screen.getByRole("textbox", {
      name: "Payee"
    }), {
      target: {
        value: "Example landlord"
      }
    });
  });
  act(() => {
    fireEvent.click(screen.getAllByRole("button", {
      name: "Restore"
    })[0]);
  });
  assert.equal((screen.getByRole("textbox", {
    name: "Description"
  }) as HTMLInputElement).value, "Standing order");

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "expense",
    counterparty: "Example landlord",
    description: "Standing order"
  });
});

test("untouched bank text with surrounding spaces is not sent as an override", async context => {
  const {
    requests,
    save
  } = await renderDialog(context, {
    ...outgoing,
    counterparty: " Synthetic savings ",
    source_counterparty: " Synthetic savings ",
    description: "Standing order ",
    source_description: "Standing order "
  });

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "expense"
  });
});

test("a hidden booking offers no transfer targets and saves a transfer without a link", async context => {
  const {
    requests,
    save,
    screen
  } = await renderDialog(context, {
    ...outgoing,
    hidden: true
  });

  act(() => {
    fireEvent.change(screen.getByRole("combobox", {
      name: "Type"
    }), {
      target: {
        value: "transfer"
      }
    });
  });
  await wait(0);

  assert.equal(requests("transactions/out/transfer").length, 0);
  assert.equal(screen.queryByRole("combobox", {
    name: "Target account"
  }), null);
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/details")[0]?.body, {
    type: "transfer"
  });
});

test("a counterpart Ufer created on a manual account offers neither text overrides nor hiding and sends no text", async context => {
  const {
    requests,
    save,
    screen
  } = await renderDialog(context, {
    ...outgoing,
    id: "created",
    amount_minor: 35000,
    account_name: "Synthetic flat",
    type: "income",
    manual_account: true,
    created_counterpart: true
  });

  assert.equal(screen.queryByRole("textbox", {
    name: "Payee"
  }), null);
  assert.equal(screen.queryByRole("button", {
    name: "Hide transaction"
  }), null);
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/created/details")[0]?.body, {
    type: "income"
  });
});

test("a booking Ufer created on a manual account offers only removing it, without suggestions or a target account", async context => {
  const created = {
    ...outgoing,
    id: "created",
    amount_minor: 35000,
    account_name: "Synthetic flat",
    type: "transfer" as const,
    manual_account: true,
    created_counterpart: true,
    counterpart: {
      id: "source",
      account_name: "Synthetic checking",
      booking_date: "2026-09-02"
    }
  };
  const {
    requests,
    save,
    screen
  } = await renderDialog(context, created);

  await respond(requests("transactions/created/transfer")[0], Response.json({
    counterpart: {
      ...booking("source", "Synthetic checking"),
      amount_minor: -35000
    },
    candidates: [booking("candidate", "Synthetic savings")],
    accounts: [{
      id: "flat",
      name: "Synthetic flat"
    }]
  } satisfies TransferOptions));

  assert.ok(screen.getByText(/Created for the transfer of Synthetic checking/));
  assert.equal(screen.queryByRole("radio"), null);
  assert.equal(screen.queryByRole("combobox", {
    name: "Target account"
  }), null);

  act(() => {
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Remove this booking"
    }));
  });

  assert.ok(screen.getByText(/Save removes this booking/));

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/created/details")[0]?.body, {
    type: "transfer",
    transfer: null
  });
});

test("one side of a transfer entered between manual accounts edits the pair: the other account is the target and Save sends the entry", async context => {
  const created: Transaction = {
    ...outgoing,
    id: "created",
    account_id: "savings",
    account_name: "Synthetic savings",
    amount_minor: 20000,
    counterparty: "Synthetic cash",
    description: "Monthly saving",
    type: "transfer",
    manual_account: true,
    created_counterpart: true,
    entered: true,
    counterpart: {
      id: "source",
      account_name: "Synthetic cash",
      booking_date: "2026-09-02"
    }
  };
  const {
    requests,
    save,
    screen,
    target
  } = await renderDialog(context, created);

  await respond(requests("transactions/created/transfer")[0], Response.json({
    counterpart: {
      ...booking("source", "Synthetic cash"),
      account_id: "cash",
      amount_minor: -20000,
      entered: true
    },
    candidates: [],
    accounts: [{
      id: "cash",
      name: "Synthetic cash"
    }, {
      id: "broker",
      name: "Synthetic broker"
    }]
  } satisfies TransferOptions));

  // A created side of an entered pair is not limited to keeping or removing its link, and its payee is the other account.
  assert.equal(screen.queryByRole("checkbox", {
    name: "Remove this booking"
  }), null);
  assert.equal(screen.queryByRole("textbox", {
    name: "Payee"
  }), null);
  assert.equal(target().value, "account:cash");

  act(() => {
    fireEvent.change(screen.getByRole("textbox", {
      name: "Amount"
    }), {
      target: {
        value: "250.00"
      }
    });
    fireEvent.change(target(), {
      target: {
        value: "account:broker"
      }
    });
  });
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/created")[0]?.body, {
    type: "transfer",
    transfer: {
      account_id: "broker"
    },
    booking_date: "2026-09-02",
    amount: "250.00",
    counterparty: "",
    description: "Monthly saving"
  });
  assert.equal(requests("transactions/created")[0]?.method, "PUT");
});

test("an entered booking linked with an imported booking keeps that booking's date and amount read-only", async context => {
  const { screen } = await renderDialog(context, {
    ...outgoing,
    id: "entered",
    manual_account: true,
    entered: true,
    follows_import: true,
    counterpart: {
      id: "bank",
      account_name: "Synthetic checking",
      booking_date: "2026-09-02"
    }
  });

  assert.equal((screen.getByRole("textbox", {
    name: "Amount"
  }) as HTMLInputElement).readOnly, true);
  assert.match(screen.getByText(/follow the linked booking/).textContent ?? "", /Synthetic checking/);
  assert.ok(screen.getByRole("button", {
    name: "Delete transaction"
  }));
});

type Requests = Awaited<ReturnType<typeof renderDialog>>["requests"];

async function chooseCategory(screen: ReturnType<typeof render>, requests: Requests, name: string) {
  await respond(requests("categories")[0], Response.json([{
    id: "groceries",
    name: "Groceries",
    color: "#638777",
    icon: null
  }]));

  const field = screen.getByRole("combobox", {
    name: "Category"
  });

  act(() => {
    fireEvent.click(field);
  });
  // jsdom has no Popover API, so the opened list may count as hidden there.
  act(() => {
    fireEvent.click(screen.getByRole("option", {
      name,
      hidden: true
    }));
  });
}

function categoryPatches(requests: Requests) {
  return requests("transactions/out").filter(request => request.method === "PATCH");
}

test("saving a changed category assigns it once after the details, then closes", async context => {
  const {
    closed,
    requests,
    save,
    screen
  } = await renderDialog(context, outgoing);

  await chooseCategory(screen, requests, "Groceries");
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.equal(categoryPatches(requests).length, 0);
  await respond(requests("transactions/out/details")[0], Response.json({}));
  await wait(0);

  const patches = categoryPatches(requests);

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].body, {
    category_id: "groceries"
  });
  assert.equal(closed.length, 0);

  await respond(patches[0], Response.json({
    id: "out",
    category_id: "groceries",
    category_source: "manual",
    category_rule_id: null
  }));
  await wait(0);

  assert.equal(closed.length, 1);
});

test("saving an unchanged category sends no assignment", async context => {
  const {
    closed,
    requests,
    save
  } = await renderDialog(context, outgoing);

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);
  await respond(requests("transactions/out/details")[0], Response.json({}));
  await wait(0);

  assert.equal(categoryPatches(requests).length, 0);
  assert.equal(closed.length, 1);
});

test("a failed category assignment keeps the dialog open with its error", async context => {
  const {
    closed,
    requests,
    save,
    screen
  } = await renderDialog(context, outgoing);

  await chooseCategory(screen, requests, "Groceries");
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);
  await respond(requests("transactions/out/details")[0], Response.json({}));
  await wait(0);
  await respond(categoryPatches(requests)[0], Response.json({
    title: "Category not found.",
    status: 422,
    detail: "Category not found."
  }, {
    status: 422,
    headers: {
      "content-type": "application/problem+json"
    }
  }));
  await wait(0);

  assert.equal(closed.length, 0);
  assert.ok(screen.getByText(/Category not found/));
  assert.equal(save().disabled, false);
});

test("a changed category is still assigned when the details' refresh removes the dialog", async context => {
  const {
    requests,
    save,
    screen
  } = await renderDialog(context, outgoing);

  await chooseCategory(screen, requests, "Groceries");
  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  // The refreshed list no longer contains the row, which unmounts its dialog.
  screen.unmount();
  await respond(requests("transactions/out/details")[0], Response.json({}));
  await wait(0);

  assert.equal(categoryPatches(requests).length, 1);
});
