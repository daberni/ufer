---
title: "Track brokerage holdings from trades and value them with daily prices"
adr:
  id: "012"
  status: accepted
  date: 2026-11-22
  authors:
    - Ufer maintainers
---

# Track brokerage holdings from trades and value them with daily prices

## Context

[#266](https://github.com/daberni/ufer/issues/266) asks for brokerage accounts whose value is their securities at the price of each day. The owner's design decisions on the issue are binding (account split, per-security prices and splits, moving average, dividends as income, currencies, EODHD behind an interface, bring-your-own key). Today an `investment` account is a manual account whose balance is the sum of its transactions ([ADR 009](009-manual-account-balances-from-transactions.md)); Buxfer trades import as hidden bookings (#270) because Buxfer exports no quantities. Net-worth history samples each account's dated balance series (`readBalanceHistory` → `netWorthSeries`).

## Decision

| Concern | Decision |
| --- | --- |
| Account kind | New kind `brokerage` in the `investments` net-worth category. It has no transactions; its balance on day X is its valuation on day X. It is not one of the kinds whose balance comes from transactions, so it cannot be created as a manual account, chosen as an import target or changed into another kind. The existing `investment` kind stays a manual account for funds valued by Update balance; no data is converted |
| Securities | `securities`: id, ISIN, name, quote currency, provider (`eodhd` or none), provider symbol (e.g. `VWCE.XETRA`), venue/MIC, last price attempt and last error. Unique on provider symbol. Shared across accounts |
| Prices and splits | `security_prices` (security, date, close, source, fetched_at; PK security+date) and `security_splits` (security, date, numerator, denominator). Provider data, upserted, never transactions |
| Exact numbers | Quantities as integer micro-units (6 decimals, covers fractional savings-plan units), prices as integer micro-units of the quote currency, money as integer minor units. A value is quantity × price rounded half to even, computed in BigInt; no floating point |
| Trades | `security_trades`: brokerage account, security, date, side (buy/sell), a sequence unique per account that orders same-day trades for replay, quantity, price, gross, fees and taxes (minor units), settlement transaction id. The only source of truth for positions; no lot table |
| Cash leg | New transaction types `buy` and `sell` on the settlement account, excluded from cash flow like transfers; only a trade sets them, a person never chooses them for a booking. Manual settlement account: the trade creates the booking (`manual:<id>`), edited and deleted together with it. Synced settlement account: the trade links an existing bank booking of the matching amount instead (suggestions as in ADR 008), the bank booking stays the source of truth, and the trade follows its redelivered date |
| Holdings | Quantity on day X = Σ buys − Σ sells up to X, multiplied by split factors after each trade up to X. Pure function, no stored holdings. A sell beyond the held quantity is a 422 |
| Cost basis | Moving average including buy fees; a sale realizes its gross proceeds less its fees and the average cost of the sold part. Splits keep the total cost. Fees stay a separate field on the trade, so a later tax view can treat purchase costs differently (in Austria they are not deductible for KESt). Taxes withheld on a sale move cash only. Realized gains are shown per holding, not counted as income in cash flow |
| Valuation | Latest price on or before X, never later. A holding without such a price has no value, counts 0 toward totals and is flagged missing; a price more than 7 days older than X (a fund's one-day lag plus a weekend fit within it) is used and flagged stale with its date. Brokerage balance history is the daily valuation from the first trade |
| Currencies | A holding counts toward the brokerage balance and net worth only when its quote currency equals the account currency; other holdings are listed unconverted and flagged until ECB rates exist. In the first version a trade's cash moves in the security's currency, which must be the settlement account's currency |
| Dividends | Ordinary income on the settlement account with a seeded `Dividend` category and optional `security_id` reference |
| Provider | `MarketDataProvider` interface (search by ISIN, daily closes and splits for a symbol and date range) with an EODHD adapter; the key comes from the instance's environment (bring your own key). Without a key, securities can still be entered, the price job is a clean no-op and holdings show "no price source configured" |
| Manual prices | Not part of the first version; a later change can add them as price observations with a manual source |
| Price job | Runs in the existing daily `/api/cron` after bank sync, under its own `market-data` lease (it writes no bookings, so it does not take the sync lease). One request per security with a provider symbol, fetching from the day after its newest price; failures are stored on the security and shown, never retried in a loop (free plan: 20 calls/day, failed calls count) |

### Amendment 2026-11-22: cash legs in the first version

| Concern | Decision |
| --- | --- |
| Trade amounts | A trade keeps its own date and amounts. A linked bank booking must match the trade's cash amount exactly and lie at most 14 days from the trade date; a later redelivery that corrects the booking changes the booking only, not the trade. This replaces "the trade follows its redelivered date" above |
| Editing | A trade is corrected (date, shares, price, fees, taxes) or removed only from its booking, which shows the trade and links to its brokerage account; the depot lists holdings and trades read-only and opens each trade's booking. A corrected trade on a bank booking must still match the booking; a trade's own cash entry follows the correction. A trade's cash side cannot be edited, retyped, hidden or linked as a transfer on its own. Removing a trade returns its bank booking to the type its delivery implies; a type a person or rule had set before is not restored (known limitation) |
| Settlement | Each trade names its cash side: a manual settlement account, where the trade books an entry, or an imported bank booking. A bank-linked settlement account always needs its bank booking, so cash is never booked twice |
| Brokerage accounts | Take no bookings, balances, transfers, import rows or bank connection, cannot change their kind, and are deleted only after their trades |

### Amendment 2026-11-22: trade entry and unpriced holdings (owner decision)

| Concern | Decision |
| --- | --- |
| Trade entry | A trade asks only for ISIN, shares, price, fees, taxes and date. The main flow starts from an imported buy or sale booking on the settlement account: the ISIN is read from its text (ISO 6166 with check digit), and its date and cash amount are taken over, the booking becoming the trade's cash side. The trade is recorded only when its cash amount matches the booking. A manual cash account remains the fallback |
| Price listing | The listing is an internal, optional detail of the security. Saving a trade only validates the ISIN by its check digit and never calls the provider; the next daily price update searches the ISIN once and picks a listing in the security's currency, preferring XETRA and other liquid venues, then fetches its prices. There is no listing field; the chosen venue is shown with the current price |
| No listing | A security without a listing, or without a configured key, is valid and has no daily price |
| Unpriced holdings | A holding without any price is valued at its cost basis and shown as "no price", instead of counting 0; a holding with only an old price keeps that price and is shown as stale. This replaces "counts 0" in the valuation row above |

## Consequences

- Net worth and its history include holdings at historical prices; manual `investment` accounts keep working.
- A past-dated buy counts at its cost basis before the first stored price, flagged as missing a market price, until history backfill (out of scope).
- Realized gains are visible per holding but not in income reports yet.
- Changeset 0022 rebuilds `accounts` and `transactions` to widen their kind and type constraints and adds four tables; every existing row keeps its values. Applying it to a hosted database is a separate, explicitly approved step.

## Compliance

- [Holdings tests](../../../tests/securities-holdings.test.ts) cover moving-average cost with fees, partial and full sales, splits before same-day trades, oversell refusal, exact micro-unit amounts, prices without look-ahead and missing or stale valuations.
- [Changeset tests](../../../tests/brokerage-holdings-migration.test.ts) compare every account, booking, split, identifier, snapshot and index before and after changeset 0022 and check the new constraints.
- Later parts add behavior tests against SQLite for trades and cash legs on manual and synced settlement accounts, valuation without transactions, net-worth history without look-ahead prices and the price job with a fake provider.

## Notes

- Owner decisions: [#266](https://github.com/daberni/ufer/issues/266#issuecomment-7066170220); provider evaluation: [market data providers](../../market-data-providers.md).
- Implementation is split into reviewable parts: schema and holdings calculations (this change); securities, brokerage accounts and trades; valuation in balances and net worth; market data provider and price job; holdings UI and demo data.
- Buxfer's hidden investment rows stay hidden; without quantities they cannot become trades.
- [ADR 008](008-transaction-types-and-transfers.md), [ADR 009](009-manual-account-balances-from-transactions.md), [ADR 010](010-bank-account-balances-from-transactions.md)
