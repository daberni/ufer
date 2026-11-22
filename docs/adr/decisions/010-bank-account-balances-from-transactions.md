---
title: "Derive bank-linked account balances from their transactions"
adr:
  id: "010"
  status: accepted
  date: 2026-11-21
  authors:
    - Ufer maintainers
---

# Derive bank-linked account balances from their transactions

## Context

[ADR 009](009-manual-account-balances-from-transactions.md) made a manual account's balance the sum of its transactions, while synced accounts kept the balance their bank reported in `accounts.balance_minor` and dated `balance_snapshots`. Balance, history and net worth therefore followed two models, and bookings added to a bank-linked account by a CSV import ([#14](https://github.com/daberni/ufer/issues/14)) or a correction were not reflected in its bank balance. [#183](https://github.com/daberni/ufer/issues/183) asks for one model with the bank balance kept for comparison.

## Decision

| Concern | Decision |
| --- | --- |
| Balance | Every account's balance is the sum of its visible transactions, dated with its newest booking; history and net worth read the running balance. `accounts.balance_minor` and `balance_date` are no longer used |
| Opening balance | The first sync of a bank-linked account books an `opening_balance` for the difference between the reported balance and the visible bookings through its date, dated the day before the oldest booking |
| Older bookings | Bookings dated on or before the opening balance, from a wider sync window or a file import, were part of it: the opening balance shrinks by their sum and moves to the day before them, so the current balance stays the same. Later bookings change the balance normally |
| Reported balance | Each sync keeps the reported balance with its provider classification ([#167](https://github.com/daberni/ufer/issues/167)) in `balance_snapshots`. The newest one is compared with the calculated balance at the end of its date when it is a booked balance (`CLBD`, `ITBD`, `PRCD`); available and expected balances include credit lines or pending items and are never compared |
| Mismatch | A difference is shown on the account card and details. Book adjustment records an `adjustment` for the difference on the reported date while holding the sync lease. Syncs never book corrections themselves |
| History | Historical differences between reported balances and bookings are not booked as corrections; the balance history shows them per reported day and marks where each difference starts ([#274](https://github.com/daberni/ufer/issues/274)) |

Changeset 0017 converts existing bank-linked accounts: one opening balance per account books the stored balance minus its visible bookings, dated the day before its oldest booking, snapshot or balance date, a stored balance without a snapshot is kept as one, and `balance_minor`/`balance_date` are cleared. Current balances and net worth stay identical.

## Consequences

- Balance, history, net worth, archiving and disconnecting use the same booking sum for every account; an account's balance is never unknown, only 0 without bookings.
- A synced account's history is its running balance; on dates where an earlier report disagreed with the bookings it shows the calculated value instead of the reported one.
- A booking missing from or duplicated in the bank delivery shows up as a difference to the reported balance instead of being hidden by it.
- CSV imports into bank-linked accounts extend their history without changing the balance; overlapping rows that are not detected as duplicates show up as a difference.
- Applying changeset 0017 to a hosted database is a separate, explicitly approved maintenance step.

## Compliance

- [Bank balance tests](../../../tests/bank-balances.test.ts) cover the first-sync opening balance, later syncs and older bookings, file imports before the opening balance, mismatch detection only for booked balances, reconciling, and the upgrade keeping balances, net worth and cash flow identical before a following sync.

## Notes

- [Changeset 0017](../../database-migrations.md)
- Amends the synced-account rows of [ADR 009](009-manual-account-balances-from-transactions.md)
