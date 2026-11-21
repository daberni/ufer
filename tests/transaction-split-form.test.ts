import "./fixtures/dom-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import type { Transaction } from "../src/features/transactions/types";
import { browser, respond, wait, withQueryClient } from "./fixtures/browser";
import { stubCssModules } from "./fixtures/css-modules";

stubCssModules();

const outgoing: Transaction = {
  id: "out",
  booking_date: "2026-09-02",
  bank_booking_date: null,
  amount_minor: -35000,
  currency: "EUR",
  instructed_amount_minor: null,
  instructed_currency: null,
  counterparty: "Example Market",
  description: "Synthetic purchase",
  source_counterparty: "Example Market",
  source_description: "Synthetic purchase",
  hidden: false,
  account_name: "Synthetic checking",
  account_id: "synthetic-checking",
  account_archived: false,
  category_id: null,
  category_source: "rule",
  category_rule_id: null,
  automatic_assignment: null,
  split: null,
  type: "expense",
  type_source: "auto",
  type_rule_id: null,
  manual_account: false,
  entered: false,
  follows_import: false,
  created_counterpart: false,
  counterpart: null,
  counterpart_archived: false
};

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
    closed
  };
}

test("a part short of the total blocks Save until Add part fills in the rest, and Save stores the details and the split in one request", async context => {
  const {
    requests,
    screen,
    closed
  } = await renderDialog(context, outgoing);

  fireEvent.click(screen.getByRole("button", {
    name: "Split into categories"
  }));

  const amount = (position: number) => screen.getByRole("textbox", {
    name: `Amount of part ${position}`
  }) as HTMLInputElement;
  const save = () => screen.getByRole("button", {
    name: "Save"
  }) as HTMLButtonElement;

  assert.equal(amount(1).value, "350.00");
  fireEvent.change(amount(1), {
    target: {
      value: "240"
    }
  });
  assert.ok(screen.getByText("€110.00 still to assign"));
  assert.equal(save().disabled, true);

  fireEvent.click(screen.getByRole("button", {
    name: "Add part"
  }));
  assert.equal(amount(2).value, "110.00");
  await wait(0);
  assert.equal(document.activeElement?.id, screen.getByRole("combobox", {
    name: "Category of part 2"
  }).id);
  fireEvent.change(amount(2), {
    target: {
      value: "200"
    }
  });
  assert.ok(screen.getByText("€90.00 more than the total"));
  assert.equal(save().disabled, true);

  fireEvent.change(amount(2), {
    target: {
      value: "100"
    }
  });
  fireEvent.click(screen.getByRole("button", {
    name: "Add part"
  }));
  assert.equal(amount(3).value, "10.00");
  fireEvent.click(screen.getByRole("button", {
    name: "Add part"
  }));
  assert.equal(amount(4).value, "0.00");
  assert.ok(screen.getByText("Fully assigned"));
  assert.equal(save().disabled, false);

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  const request = requests("transactions/out/details")[0];

  assert.deepEqual((request?.body as {
    split?: unknown;
  } | undefined)?.split, {
    parts: [{
      amount: "-240.00",
      category_id: null,
      note: ""
    }, {
      amount: "-100.00",
      category_id: null,
      note: ""
    }, {
      amount: "-10.00",
      category_id: null,
      note: ""
    }]
  });
  // Save stays disabled until the one request settles.
  assert.equal(save().disabled, true);
  await respond(request, Response.json({
    ok: true
  }));
  await wait(0);
  assert.equal(requests("transactions/out/split").length, 0);
  assert.deepEqual(closed, [true]);
});

test("cancelling a split returns to the category, and a split that was not changed into parts saves no split", async context => {
  const {
    requests,
    screen
  } = await renderDialog(context, outgoing);

  fireEvent.click(screen.getByRole("button", {
    name: "Split into categories"
  }));
  fireEvent.click(screen.getByRole("button", {
    name: "Cancel split"
  }));
  assert.ok(screen.getByRole("button", {
    name: "Split into categories"
  }));

  fireEvent.click(screen.getByRole("button", {
    name: "Split into categories"
  }));
  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Save"
    }));
  });
  await wait(0);
  await respond(requests("transactions/out/details")[0], Response.json({}));
  await wait(0);
  assert.equal(requests("transactions/out/split").length, 0);
});

test("removing a stored split sends the removal with the details and returns to the category picker", async context => {
  const {
    requests,
    screen,
    closed
  } = await renderDialog(context, {
    ...outgoing,
    category_source: "manual",
    split: {
      parts: [{
        id: "part-1",
        amount_minor: -20000,
        category_id: null,
        note: ""
      }, {
        id: "part-2",
        amount_minor: -15000,
        category_id: null,
        note: ""
      }],
      balanced: true
    }
  });

  fireEvent.click(screen.getByRole("button", {
    name: "Remove split"
  }));
  assert.ok(screen.getByRole("button", {
    name: "Split into categories"
  }));
  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Save"
    }));
  });
  await wait(0);
  const details = requests("transactions/out/details")[0];

  assert.equal((details?.body as {
    remove_split?: boolean
  }).remove_split, true);
  await respond(details, Response.json({}));
  await wait(0);
  assert.equal(requests("transactions/out/split").length, 0);
  assert.deepEqual(closed, [true]);
});

test("a split of a booking entered in Ufer follows the amount being edited in the same dialog", async context => {
  const {
    screen
  } = await renderDialog(context, {
    ...outgoing,
    entered: true,
    manual_account: true
  });
  const amount = (position: number) => screen.getByRole("textbox", {
    name: `Amount of part ${position}`
  }) as HTMLInputElement;

  fireEvent.change(screen.getByRole("textbox", {
    name: "Amount"
  }), {
    target: {
      value: "-400.00"
    }
  });
  fireEvent.click(screen.getByRole("button", {
    name: "Split into categories"
  }));
  assert.equal(amount(1).value, "400.00");

  fireEvent.change(amount(1), {
    target: {
      value: "300"
    }
  });
  fireEvent.click(screen.getByRole("button", {
    name: "Add part"
  }));
  assert.equal(amount(2).value, "100.00");
  assert.ok(screen.getByText("Fully assigned"));

  fireEvent.change(screen.getByRole("textbox", {
    name: "Amount"
  }), {
    target: {
      value: "-450.00"
    }
  });
  assert.ok(screen.getByText("€50.00 still to assign"));
  assert.equal((screen.getByRole("button", {
    name: "Save"
  }) as HTMLButtonElement).disabled, true);
});

test("removing a stored split and choosing a type it does not allow removes the split in the same request as the type", async context => {
  const {
    requests,
    screen,
    closed
  } = await renderDialog(context, {
    ...outgoing,
    manual_account: true,
    split: {
      parts: [{
        id: "part-1",
        amount_minor: -20000,
        category_id: null,
        note: ""
      }, {
        id: "part-2",
        amount_minor: -15000,
        category_id: null,
        note: ""
      }],
      balanced: true
    }
  });

  fireEvent.click(screen.getByRole("button", {
    name: "Remove split"
  }));
  fireEvent.change(screen.getByRole("combobox", {
    name: "Type"
  }), {
    target: {
      value: "adjustment"
    }
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Save"
    }));
  });
  await wait(0);

  const details = requests("transactions/out/details")[0];

  assert.deepEqual(details?.body, {
    type: "adjustment",
    remove_split: true
  });
  await respond(details, Response.json({}));
  await wait(0);
  assert.equal(requests("transactions/out/split").length, 0);
  assert.deepEqual(closed, [true]);
});

test("split parts cannot be changed while the save runs", async context => {
  const {
    requests,
    screen
  } = await renderDialog(context, outgoing);

  fireEvent.click(screen.getByRole("button", {
    name: "Split into categories"
  }));
  fireEvent.change(screen.getByRole("textbox", {
    name: "Amount of part 1"
  }), {
    target: {
      value: "300"
    }
  });
  fireEvent.click(screen.getByRole("button", {
    name: "Add part"
  }));
  act(() => {
    fireEvent.click(screen.getByRole("button", {
      name: "Save"
    }));
  });
  await wait(0);

  const controls = [
    screen.getByRole("textbox", {
      name: "Amount of part 2"
    }),
    screen.getByRole("combobox", {
      name: "Category of part 2"
    }),
    screen.getByRole("textbox", {
      name: "Note of part 2"
    }),
    screen.getByRole("button", {
      name: "Remove part 2"
    }),
    screen.getByRole("button", {
      name: "Add part"
    }),
    screen.getByRole("button", {
      name: "Cancel split"
    }),
    screen.getByRole("combobox", {
      name: "Type"
    })
  ];

  assert.ok(controls.every(control => control.matches(":disabled")));
  await respond(requests("transactions/out/details")[0], Response.json({}, {
    status: 500
  }));
  await wait(0);
  assert.ok(controls.every(control => !control.matches(":disabled")));
});
