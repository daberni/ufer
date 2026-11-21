import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTypeChange, type TypeChangeFacts } from "../src/features/transactions/server/type-change-decision";
import type { Subject } from "../src/features/transactions/server/transfer-subjects";

function booking(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "booking",
    account_id: "checking",
    account_name: "Checking",
    account_provider: "enable_banking",
    account_archived_at: null,
    provider_reference: "bank-1",
    booking_date: "2026-03-01",
    amount_minor: -5000,
    currency: "EUR",
    counterparty: "Savings",
    description: "",
    category_id: null,
    type: "expense",
    transfer_id: null,
    ...overrides
  } as Subject;
}

function facts(overrides: Partial<TypeChangeFacts>): TypeChangeFacts {
  return {
    subject: booking(),
    counterpart: undefined,
    chosen: undefined,
    type: "transfer",
    target: undefined,
    ...overrides
  };
}

const linkedImport = booking({
  transfer_id: "t1",
  type: "transfer"
});
const importedCounterpart = booking({
  id: "other",
  account_id: "savings",
  amount_minor: 5000,
  provider_reference: "bank-2",
  transfer_id: "t1",
  type: "transfer"
});

test("an archived account only allows relinking imported bookings", () => {
  const archived = booking({
    ...linkedImport,
    account_archived_at: "2026-04-01T00:00:00Z"
  });

  assert.deepEqual(decideTypeChange(facts({
    subject: archived,
    counterpart: importedCounterpart,
    type: "income"
  })), {
    kind: "reject",
    result: "archived_account"
  });
  assert.equal(decideTypeChange(facts({
    subject: archived,
    counterpart: importedCounterpart,
    type: "expense"
  })).kind, "leave_transfer");
  assert.equal(decideTypeChange(facts({
    subject: archived,
    counterpart: importedCounterpart,
    target: null
  })).kind, "without_counterpart");
});

test("an archived account rejects linking an entered booking, whose date would follow", () => {
  const archived = booking({
    account_archived_at: "2026-04-01T00:00:00Z"
  });
  const entered = booking({
    id: "entered",
    account_id: "cash",
    account_provider: "manual",
    provider_reference: "manual:entered",
    amount_minor: 5000
  });

  assert.equal(decideTypeChange(facts({
    subject: archived,
    chosen: entered,
    target: {
      counterpartId: "entered"
    }
  })).kind, "reject");
  assert.equal(decideTypeChange(facts({
    subject: archived,
    chosen: importedCounterpart,
    target: {
      counterpartId: "other"
    }
  })).kind, "link_existing");
});

test("a bank-linked booking never enters or leaves a manual-account type", () => {
  assert.deepEqual(decideTypeChange(facts({
    type: "adjustment"
  })), {
    kind: "reject",
    result: "manual_account_only"
  });
  assert.deepEqual(decideTypeChange(facts({
    subject: booking({
      type: "opening_balance",
      provider_reference: "manual:opening"
    }),
    type: "income"
  })), {
    kind: "reject",
    result: "manual_account_only"
  });
});

test("one side of an entered pair changes the pair together", () => {
  const subject = booking({
    account_provider: "manual",
    provider_reference: "manual:booking",
    transfer_id: "t1",
    type: "transfer"
  });
  const counterpart = booking({
    id: "other",
    account_id: "cash",
    account_provider: "manual",
    provider_reference: "transfer:booking",
    transfer_id: "t1",
    type: "transfer"
  });

  assert.deepEqual(decideTypeChange(facts({
    subject,
    counterpart,
    type: "expense"
  })), {
    kind: "change_entered_pair",
    counterpart
  });
});

test("a created counterpart keeps its link or loses it, but is never retargeted", () => {
  const created = booking({
    id: "created",
    account_id: "cash",
    account_provider: "manual",
    provider_reference: "transfer:other",
    amount_minor: 5000,
    transfer_id: "t1",
    type: "transfer"
  });

  assert.deepEqual(decideTypeChange(facts({
    subject: created,
    counterpart: importedCounterpart,
    target: {
      accountId: "wallet"
    }
  })), {
    kind: "reject",
    result: "created_counterpart"
  });
  assert.equal(decideTypeChange(facts({
    subject: created,
    counterpart: importedCounterpart,
    target: null
  })).kind, "without_counterpart");
});

test("a transfer without a target keeps its link and pairs only when it had none", () => {
  assert.deepEqual(decideTypeChange(facts({})), {
    kind: "keep_link",
    pairAfterwards: true
  });
  assert.deepEqual(decideTypeChange(facts({
    subject: linkedImport,
    counterpart: importedCounterpart
  })), {
    kind: "keep_link",
    pairAfterwards: false
  });
});

test("a transfer target selects linking a booking, creating on a manual account or no counterpart", () => {
  assert.deepEqual(decideTypeChange(facts({
    target: {
      counterpartId: "other"
    }
  })), {
    kind: "link_existing",
    counterpartId: "other"
  });
  assert.deepEqual(decideTypeChange(facts({
    target: {
      accountId: "cash"
    }
  })), {
    kind: "link_manual_account",
    accountId: "cash"
  });
  assert.deepEqual(decideTypeChange(facts({
    target: null
  })), {
    kind: "without_counterpart"
  });
});
