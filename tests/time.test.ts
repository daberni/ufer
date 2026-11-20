import { test } from "node:test";
import assert from "node:assert/strict";
import { Temporal } from "temporal-polyfill";
import { timestamp, today } from "../src/lib/time";
import { syncWindowStart } from "../src/features/banking/server/sync-service";
import { accountGroups } from "../src/features/accounts/queries";
import type { Account } from "../src/features/accounts/types";

test("today follows the Vienna calendar day, not the UTC date", () => {
  assert.equal(today(Temporal.Instant.from("2026-03-01T22:59:59Z")).toString(), "2026-03-01");
  assert.equal(today(Temporal.Instant.from("2026-03-01T23:30:00Z")).toString(), "2026-03-02");
  assert.equal(today(Temporal.Instant.from("2026-06-30T21:59:59Z")).toString(), "2026-06-30");
  assert.equal(today(Temporal.Instant.from("2026-06-30T22:30:00Z")).toString(), "2026-07-01");
});

test("persisted timestamps keep the database's millisecond UTC format", () => {
  assert.equal(timestamp(Temporal.Instant.from("2026-11-12T00:00:00Z")), "2026-11-12T00:00:00.000Z");
  assert.equal(timestamp(Temporal.Instant.from("2026-11-12T08:15:30.123456789Z")), "2026-11-12T08:15:30.123Z");
  assert.match(timestamp(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("the sync window counts calendar days back across a daylight-saving change", () => {
  // 00:30 summer time on 15 April; the window reaches back past the March change into winter time.
  assert.equal(syncWindowStart(Temporal.Instant.from("2026-04-14T22:30:00Z")).toString(), "2026-01-16");
  assert.equal(syncWindowStart(Temporal.Instant.from("2026-04-15T12:00:00Z")).toString(), "2026-01-16");
  // 00:30 winter time on 26 October, the day after the change back.
  assert.equal(syncWindowStart(Temporal.Instant.from("2026-10-25T23:30:00Z")).toString(), "2026-07-29");
});

function bankAccount(id: string, validUntil: string | null): Account {
  return {
    id,
    name: id,
    provider_name: null,
    institution: "Example institution",
    kind: "checking",
    currency: "EUR",
    balance_minor: 0,
    balance_date: "2026-11-01",
    provider: "enable_banking",
    requisition_id: "connection",
    sync_error: null,
    last_synced_at: null,
    valid_until: validUntil,
    archived_at: null
  };
}

test("authorizations expiring within seven days are flagged by instant, whatever their offset notation", () => {
  const now = Temporal.Instant.from("2026-11-12T12:00:00Z");
  const accounts = [
    bankAccount("expired", "2026-11-12T11:59:59.999Z"),
    bankAccount("within-week", "2026-11-19T11:59:59.999999+00:00"),
    bankAccount("week-later-elsewhere", "2026-11-19T13:00:00+01:00"),
    bankAccount("later", "2026-11-19T12:00:00.001Z"),
    bankAccount("unlinked", null)
  ];

  assert.deepEqual(accountGroups(accounts, "EUR", now).expiring.map(account => account.id), ["expired", "within-week"]);
});
