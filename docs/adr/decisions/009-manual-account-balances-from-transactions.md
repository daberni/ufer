---
title: "Derive manual account balances from their transactions"
adr:
  id: "009"
  status: accepted
  date: 2026-11-17
  authors:
    - Ufer maintainers
---

# Derive manual account balances from their transactions

## Context

A manual account (cash, savings, investment, property, loan) was a series of dated balances in `balance_snapshots` with source `manual` or `csv`, and its current balance was stored on the account. Transactions reached it only through a CSV import or as a transfer counterpart ([ADR 008](008-transaction-types-and-transfers.md)), and they did not change its balance. Money moving between a synced and a manual account was therefore entered twice and never reconciled. [#138](https://github.com/daberni/ufer/issues/138) asks for manual transactions and balances derived from them; transfers between two manual accounts must be editable from either side.

## Decision

| Concern | Decision |
| --- | --- |
| Balance | A manual account's balance is the sum of all its transactions: the opening balance, income, expenses, transfers and adjustments. Its balance date is its newest booking date; an account without transactions has no balance. Synced accounts keep their provider balance and balance snapshots (superseded for synced accounts by [ADR 010](010-bank-account-balances-from-transactions.md)) |
| Entering transactions | Manual accounts accept transactions entered in Ufer (date, signed amount, payee, description, category, type; a transfer optionally names another manual account). Without a chosen category the categorization rules choose one. Such bookings carry the reference `manual:<id>` and can be edited and deleted |
| Opening balance | Creating a manual account books its starting balance as an `opening_balance` transaction on the balance date |
| Update balance | Entering a balance for a date books an `adjustment` for the difference between it and the balance at the end of that date, so later transactions keep their effect; for today this is the difference to the current balance. An account without transactions gets an opening balance instead; no difference books nothing. Revaluations without money moving are recorded this way |
| CSV balance imports | Each imported balance is recorded like Update balance, oldest first. Importing the same file again books nothing. CSV balance imports no longer write snapshots (retired 2026-11-21, see below) |
| Reports | Opening balances and adjustments are excluded from income and spending like transfers; the cash-flow query already counts only income and expenses |
| Transfers between manual accounts | When both sides of a transfer were entered in Ufer on manual accounts (a manual entry and the counterpart created for it, or two linked manual entries), they are one movement with no source of truth. Either side edits the pair: the other side mirrors the date, the opposite amount and the description, and each side names the other's account as its payee. Changing the other account moves the other side to that account; choosing no account, another type or a different booking removes the other side; deleting either side deletes both |
| Transfers with an imported side | A booking from a bank sync or a CSV import is the source of truth. An entered booking linked with it keeps its date and amount (payee, description and type stay editable), and a counterpart Ufer created for it can only keep its link or be removed, as in ADR 008. When the imported booking is redelivered with a corrected date or amount, the entered side follows: the date always, the opposite amount while currency and direction stay the same, and the pair stays linked. A correction in the other direction or to no amount ends the link: a manual entry still takes the opposite amount as a transfer without a counterpart, and a counterpart Ufer created is removed; after a currency change both are released as in ADR 008. Deleting the entered side leaves the imported booking a transfer without a counterpart |
| Linking two entered bookings | Linking two separately entered bookings makes them an entered pair: the linked booking takes the subject's date, description and the subject's account as payee |

Changeset 0007 converts existing data without changing any current balance: for every manual account, the first snapshot becomes the opening balance and each later snapshot an adjustment, both dated as the snapshot, so the balance at the end of every snapshot date equals that snapshot. Transactions already on the account between two snapshots were part of the later snapshot, so only the remaining difference is booked; a later snapshot without a difference books nothing. Where transactions after the newest snapshot or a missing history make the sum differ from the stored balance, one more adjustment on the newest date keeps the current balance. The manual accounts' snapshots and stored balances are then removed.

### Amendment 2026-11-21: balance CSV import retired ([#282](https://github.com/daberni/ufer/issues/282))

The fixed-schema balance CSV import is removed. Update balance records a balance for a date, and the mapped CSV import brings in transaction history; opening balances and adjustments booked by earlier balance imports are kept as ordinary transactions.

## Consequences

- Money moved between a synced account and a manual account is entered once and changes both balances.
- An adjustment dated in the past changes the balance on that date and every later one; the history of a manual account is its running balance.
- A transaction imported or entered on a manual account changes its balance immediately; it is no longer a separate step to update the balance.
- A manual account's balance history no longer lives in `balance_snapshots`; a net-worth history ([#87](https://github.com/daberni/ufer/issues/87)) reads manual accounts' running balances from their transactions and synced accounts' from snapshots.
- A repeated snapshot with the same value leaves no booking; its date is not kept.
- The demo seed refuses a database whose own manual accounts hold transactions other than opening balances and adjustments, as before it refused any transactions there.
- Applying changeset 0007 to a hosted database is a separate, explicitly approved maintenance step.

## Compliance

- [Manual transaction tests](../../../tests/manual-transactions.test.ts) cover derived balances, Update balance on past dates, report exclusion, editing and deleting entries, editing, moving and removing a transfer between manual accounts from either side, entered bookings that follow an imported booking and its redelivered corrections, and linking two entered bookings.
- [Repository tests](../../../tests/repositories.test.ts) cover the opening balance at account creation and its rollback.
- [Migration tests](../../../tests/migrations.test.ts) build a database before changeset 0007 and compare every balance, the balance at each snapshot date, original transactions and cash-flow results before and after it.

## Notes

- [Manual account changeset](../../database-migrations.md#changesets)
- [Architecture: transaction types and transfers](../../architecture.md#transaction-types-and-transfers)
