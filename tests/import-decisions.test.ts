import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAccountMapping, mappableBankAccount } from "../src/features/banking/server/bank-account-mapping";
import { openingBookingAmount, sameOpening } from "../src/features/imports/server/opening-balance-decisions";
import { maximumTemplates, requireTemplateCapacity, requireUniqueTemplate, TemplateLimitReached } from "../src/features/imports/server/template-decisions";
import { HttpError } from "../src/lib/errors";

const current = {
  id: "opening-current",
  kind: "current" as const,
  amount: 10_000,
  date: "2026-01-01"
};

test("a current opening balance books today's balance minus the other transactions; a start balance is booked as given", () => {
  assert.equal(openingBookingAmount(current, 2_500), 7_500);
  assert.equal(openingBookingAmount({
    ...current,
    kind: "start"
  }, 2_500), 10_000);
});

test("a resumed import keeps its opening balance only when kind, date and stated amount are unchanged", () => {
  const stored = {
    id: current.id,
    date: current.date,
    amount: 7_500,
    others: 2_500
  };

  assert.equal(sameOpening(stored, current), true);
  assert.equal(sameOpening(null, null), true);
  assert.equal(sameOpening(stored, null), false);
  assert.equal(sameOpening(null, current), false);
  assert.equal(sameOpening(stored, {
    ...current,
    amount: 9_000
  }), false);
  assert.equal(sameOpening(stored, {
    ...current,
    date: "2026-01-02"
  }), false);
  // A start balance compares the booking alone, and its ID differs from the current one's.
  assert.equal(sameOpening({
    ...stored,
    id: "opening-start"
  }, {
    ...current,
    id: "opening-start",
    kind: "start",
    amount: 7_500
  }), true);
  assert.equal(sameOpening(stored, {
    ...current,
    id: "opening-start",
    kind: "start"
  }), false);
});

test("a template beyond the limit is refused", () => {
  assert.doesNotThrow(() => requireTemplateCapacity(maximumTemplates - 1));
  assert.throws(() => requireTemplateCapacity(maximumTemplates), TemplateLimitReached);
});

test("another template's name or header conflicts, the changed template's own does not", () => {
  const other = {
    id: "other",
    name: "Bank export"
  };

  assert.doesNotThrow(() => requireUniqueTemplate("Bank export", undefined, undefined, null));
  assert.doesNotThrow(() => requireUniqueTemplate("Bank export", other, other, "other"));
  assert.throws(() => requireUniqueTemplate("bank export", other, undefined, null), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === "A template named “bank export” already exists.");
  assert.throws(() => requireUniqueTemplate("New name", undefined, other, "own"), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message.startsWith("The template “Bank export” already covers"));
});

test("a bank account needs a stable identifier and an unambiguous currency; its identifiers are deduplicated", () => {
  const account = {
    uid: "uid-1",
    identification_hash: "hash-1",
    identification_hashes: ["hash-1", "hash-2"],
    currency: "EUR"
  };

  assert.deepEqual(mappableBankAccount(account).hashes, ["hash-1", "hash-2"]);

  for (const missing of [{
    identification_hash: undefined
  }, {
    uid: undefined
  }, {
    currency: "XXX"
  }]) {
    assert.throws(() => mappableBankAccount({
      ...account,
      ...missing
    } as never), (error: unknown) => error instanceof HttpError && error.status === 502);
  }
});

test("a bank account maps to its one matching account, displacing another connection, or to a new account", () => {
  assert.deepEqual(decideAccountMapping([], "connection"), {
    existing: false
  });
  assert.deepEqual(decideAccountMapping([{
    account_id: "account",
    requisition_id: "previous"
  }], "connection"), {
    existing: true,
    accountId: "account",
    displaced: "previous"
  });
  assert.deepEqual(decideAccountMapping([{
    account_id: "account",
    requisition_id: "connection"
  }], "connection"), {
    existing: true,
    accountId: "account",
    displaced: null
  });
  assert.throws(() => decideAccountMapping([{
    account_id: "a",
    requisition_id: null
  }, {
    account_id: "b",
    requisition_id: null
  }], "connection"), (error: unknown) => error instanceof HttpError && error.status === 409);
});
