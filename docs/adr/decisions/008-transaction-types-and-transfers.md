---
title: "Separate transaction types from categories and link transfer bookings"
adr:
  id: "008"
  status: accepted
  date: 2026-11-17
  authors:
    - Ufer maintainers
---

# Separate transaction types from categories and link transfer bookings

## Context

Transfers were a category flag (`is_transfer`): transactions in the seeded Transfer category were left out of cash flow, spending and trends. Whether a booking is income, spending or a movement between own accounts is a property of the booking, not of its purpose. The flag prevented categorizing transfers, gave refunds, fees, interest and investment movements no defined treatment, did not record which accounts a transfer connects and let a category edit silently change cash-flow results. Manual accounts (property, investments, cash) need transfers from synced accounts, and their balances will be derived from transactions ([#138](https://github.com/daberni/ufer/issues/138)). The decisions in [#38](https://github.com/daberni/ufer/issues/38) (2026-11-17) are binding.

## Decision

| Concern | Decision |
| --- | --- |
| Types | Every transaction has exactly one type: income, expense, transfer between own accounts, and for manual accounts opening balance and adjustment. Only income and expenses count toward cash flow, spending breakdowns and trends; categories describe purpose only |
| Refunds, fees, interest, investments | A refund stays an expense with a positive amount and reduces spending in its category. Fees are expenses, interest is income. An investment contribution is a transfer to that account |
| Default type | A synced booking whose counterparty IBAN belongs to another synced account is a transfer; otherwise income or expense by direction. Corrections are stored as manual and never recalculated. Rules categorize transfers like any other booking; no category is reserved for transfers |
| Transfer link | The two bookings of one transfer stay two transactions, each with its account's provider booking and balance, and share a `transfer_id`. They are shown with each other's account, corrected together (another type ends the link and the counterpart becomes income or expense by direction) and never count as income or spending |
| Untracked accounts | A transfer without a counterpart is a transfer to or from an account not tracked in Ufer |
| Manual accounts | Marking a booking as a transfer to or from a manual account creates the counterpart booking there, so the movement is entered once; unlinking it, or giving the created booking another type, removes that booking and the source becomes a transfer without a counterpart or, after a type change, income or expense by direction |
| Manual linking | One edit form saves a booking's type and transfer target together. Suggestions are unlinked bookings of the exact opposite amount in the same currency on another own account at most 14 days apart, and the server accepts only these. The target account list offers manual accounts only: a synced account's counterpart arrives from its bank and is linked through a suggestion or automatic pairing. Choosing no target means a transfer to an untracked account and counts as a manual unlink, so automatic pairing never links it later. A booking Ufer created on a manual account keeps its source link or is removed; it is never retargeted, and where the transfer goes is edited on the source booking |
| Automatic pairing | After sync and CSV import across the environment except demo-owned accounts, and after the demo seed among demo accounts only, so real and demo bookings never pair: a transfer and a booking with the opposite amount in the same currency on another own account at most 3 days apart, where neither is linked, manually unlinked or manually typed as something else. A pair is linked only when each side has exactly one candidate; otherwise both stay unpaired until someone links them |
| Corrections | Manual types, links and unlinks are stored with a manual source and survive resync and imports |

The changeset that introduces these columns turns transactions in a category flagged as a transfer into transfers and drops the flag; existing results do not change. It does not link existing transfers; the next sync or import pairs them.

## Consequences

- Reports no longer depend on categories, and transfers can carry a purpose category.
- A new positive booking starts as income even when it is a refund; the person corrects it to an expense. Categorization rules do not set types.
- Transfers whose two bookings differ, for example by a fee or a currency exchange, cannot be linked yet; each side stays a transfer without a counterpart.
- A category whose refunds reach or exceed its spending in a period has no spending breakdown row, while its net amount still lowers total spending.
- Manual account balances still come from valuations until #138 derives them from transactions; counterparts created on manual accounts do not change those balances yet.
- Applying the changeset to a hosted database is a separate, explicitly approved maintenance step.

## Compliance

- [Transaction type tests](../../../tests/transaction-types.test.ts) cover type derivation, pairing with one, several or no candidates, currency and window limits, manual corrections across resync, pair correction and counterparts on manual accounts.
- [Migration tests](../../../tests/migrations.test.ts) compare cash flow, spending breakdowns, rows and categories before and after the changeset.
- Code review keeps every cash-flow figure on the single type-based definition in the [cash-flow query](../../../src/features/reports/server/cash-flow-query.ts).

## Notes

- [Architecture: transaction types and transfers](../../architecture.md#transaction-types-and-transfers)
- [Transaction types changeset](../../database-migrations.md#transaction-types-changeset)
- Splits, budgets and investment valuation remain separate work.
