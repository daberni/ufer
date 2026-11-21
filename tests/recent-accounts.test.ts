import assert from "node:assert/strict";
import { test } from "node:test";
import { recentlyBookedAccounts } from "../src/features/accounts/recent-accounts";
import type { Account } from "../src/features/accounts/types";

function account(name: string, last_booking_date: string | null, balance_minor = 0): Account {
  return {
    id: name,
    name,
    provider_name: null,
    institution: "Example Bank",
    kind: "checking",
    currency: "EUR",
    balance_minor,
    balance_date: null,
    last_booking_date,
    reported_balance_minor: null,
    reported_balance_date: null,
    reported_difference_minor: null,
    provider: "manual",
    requisition_id: null,
    last_synced_at: null,
    valid_until: null,
    sync_error: null,
    archived_at: null
  };
}

const names = (accounts: Account[]) => accounts.map(entry => entry.name);

test("the overview shows the three accounts with the newest bookings, newest first, regardless of balance", () => {
  const accounts = [account("Savings", "2026-03-01", 9_000_000), account("Card", "2026-11-17", 100), account("Everyday", "2026-11-02"), account("Mortgage", "2025-12-31", -20_000_000), account("Broker", "2026-11-19")];

  assert.deepEqual(names(recentlyBookedAccounts(accounts, 3)), ["Broker", "Card", "Everyday"]);
});

test("accounts without bookings only fill places the booked accounts leave, in their listed order", () => {
  const accounts = [account("Flat", null), account("Car", null), account("Everyday", "2026-11-02"), account("Pension", null)];

  assert.deepEqual(names(recentlyBookedAccounts(accounts, 3)), ["Everyday", "Flat", "Car"]);
});

test("accounts booked on the same day keep their listed order", () => {
  const accounts = [account("Everyday", "2026-11-17"), account("Card", "2026-11-17")];

  assert.deepEqual(names(recentlyBookedAccounts(accounts, 3)), ["Everyday", "Card"]);
});
