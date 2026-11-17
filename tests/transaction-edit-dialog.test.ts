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
  account_name: "Synthetic checking",
  category_id: null,
  category_source: "rule",
  type: "expense",
  type_source: "auto",
  manual_account: false,
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
    created: false
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

  const { TransactionEditDialog } = await import("../src/features/transactions/components/transaction-edit-dialog");
  const screen = render(withQueryClient(browserEnvironment.queryClient, createElement(TransactionEditDialog, {
    transaction,
    close: () => {}
  })));

  await wait(0);

  return {
    ...browserEnvironment,
    screen,
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

  assert.deepEqual(requests("transactions/out/type")[0]?.body, {
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
  assert.match(screen.getByRole("status").textContent ?? "", /links this booking with Synthetic savings/);

  act(() => {
    fireEvent.change(target(), {
      target: {
        value: "account:flat"
      }
    });
  });

  assert.equal(suggestion().checked, false);
  assert.match(screen.getByRole("status").textContent ?? "", /counterpart on Synthetic flat/);

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/out/type")[0]?.body, {
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

  assert.deepEqual(requests("transactions/out/type")[0]?.body, {
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
  assert.deepEqual(requests("transactions/out/type")[0]?.body, {
    type: "expense"
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

  assert.ok(screen.getByText(/Ufer created this booking for the transfer of Synthetic checking/));
  assert.equal(screen.queryByRole("radio"), null);
  assert.equal(screen.queryByRole("combobox", {
    name: "Target account"
  }), null);

  act(() => {
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Remove this booking"
    }));
  });

  assert.match(screen.getByRole("status").textContent ?? "", /Save removes this booking/);

  act(() => {
    fireEvent.click(save());
  });
  await wait(0);

  assert.deepEqual(requests("transactions/created/type")[0]?.body, {
    type: "transfer",
    transfer: null
  });
});
