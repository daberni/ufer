# Market data providers for security prices

Research notes for valuing securities holdings (stocks, ETFs and mutual funds, mostly on European venues, identified by ISIN) with daily end-of-day prices. Nothing here is implemented yet; this document records the evaluation so the decision can be revisited. Facts were read from the providers' official pages on 2026-11-21 and are linked inline; items marked **unverified** could not be confirmed from public pages.

## Requirements

- One end-of-day price per security and day is enough; Ufer shows approximate holdings values, not a market data terminal.
- European listings in EUR (XETRA and other German venues, Vienna), plus non-ETF UCITS funds that only publish a daily net asset value.
- Lookup by ISIN when a security is first added.
- Historical prices from the date of a past purchase would be useful when a holding is created later (out of scope for now).
- Free or cheap for a private self-hosted instance. A hosted service for other people has different licensing needs (see [Licensing](#licensing)).

## Key findings

- Every provider counts requests **per security**. Batch or bulk endpoints save round trips, not quota (EODHD bulk costs 100 calls plus one per security; Marketstack and Twelve Data charge one unit per symbol).
- The trading venue shown by a broker is only where its displayed price comes from. Holdings are held independently of the venue, so any liquid EUR listing (for example XETRA) is a valid valuation source. Prices from venues trading into the evening (Lang & Schwarz, gettex) can differ from the XETRA close by roughly a percent on volatile days.
- Mutual fund values usually lag one day because the fund's price is published the following day.
- Storing the chosen provider symbol per security (for example `VWCE.XETRA`) keeps daily updates at one request per security; ISIN search is only needed when a security is added.

## Comparison

| Provider | Free quota | Counting | EU / Vienna | ISIN | Cheapest paid plan | Licensing |
|---|---|---|---|---|---|---|
| [EODHD](https://eodhd.com/pricing) | 20 calls/day, 1 year of history | 1 call per security; bulk 100 + 1 per security, not on the free plan ([bulk](https://eodhd.com/financial-apis/bulk-api-eod-splits-dividends)) | XETRA, Frankfurt and other German venues, Vienna `VI` ([list](https://eodhd.com/list-of-stock-markets)); EU funds under the virtual exchange `EUFUND` ([EUFUND](https://eodhd.com/exchange/EUFUND)) | Search by ISIN, also on the free plan ([search](https://eodhd.com/financial-apis/search-api-for-stocks-etfs-mutual-funds)) | €19.99/month, 100,000 calls/day, 30+ years of history | Personal plans: private, non-commercial only; commercial internal use from €399/month; display to end users only by custom agreement |
| [Tiingo](https://www.tiingo.com/about/pricing) | 500 symbols/month, 50 requests/hour, 1,000/day | Per request | "Global Securities"; European and Vienna coverage **unverified** | **Unverified** | $30/month individual, $50 internal commercial | "Internal Use Only": own use, no display or sharing |
| [Twelve Data](https://twelvedata.com/pricing) | 800 credits/day, 8/minute, 3 unnamed markets | 1 credit per symbol; `/batch` charges the sum of its requests ([batch](https://twelvedata.com/docs/advanced/batch-requests)) | Vienna listed, minimum plan Pro ([exchanges](https://twelvedata.com/exchanges)); global EOD equities from Grow | `isin` parameter on all plans ([time series](https://twelvedata.com/docs/market-data/time-series)) | $29/month (Grow), $99/month (Pro) for Vienna | Free: internal non-display; display to third parties from Venture ($149/month) |
| [Marketstack](https://marketstack.com/pricing) | 100 requests/month, 1 year of history | 1 request per symbol, up to 100 symbols per call ([FAQ](https://marketstack.com/faq)) | European and Vienna coverage **unverified** | **Unverified** | $9.99/month, 10,000 requests, then about $0.004 per request | Free "Non-Commercial Use", paid "Commercial Use"; neither term is defined publicly, display to end users **unverified** |
| Financial Modeling Prep | **Unverified** | **Unverified** | **Unverified** | **Unverified** | **Unverified** | Documentation and pricing returned HTTP 403 |
| [Polygon / Massive](https://massive.com/pricing) | No free tier seen | – | Likely US only (**unverified**) | – | $29/month and up | "Individual use only" |
| Yahoo Finance (unofficial, e.g. yfinance) | Unofficial | – | Broad | – | – | The [terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) prohibit automated collection and databases without permission; not suitable |
| Stooq | **Unverified** (site returned an empty page) | – | – | – | – | **Unverified** |
| Wiener Börse | Public prices 15 minutes delayed | – | Vienna | – | Institutional feeds only, no public price ([feeds](https://www.wienerborse.at/en/market-data/market-data-sales/market-data-feeds/)) | Institutional |

Supporting services:

- [OpenFIGI](https://www.openfigi.com/api/documentation) maps ISINs to tickers and venues for free: 25 requests/minute without a key, 250 with one, 10 or 100 identifiers per request. Its terms of service were not reviewed.
- The ECB publishes free daily euro reference exchange rates, which would cover holdings priced in other currencies. Its API page returned HTTP 503 during this review (**unverified**).

## Providers in detail

### EODHD

Pros:

- Covers XETRA, the other German venues and Vienna, and offers European fund values by ISIN (`ISIN.EUFUND`).
- ISIN search works on the free plan and returns every listing with venue and currency.
- 20 free calls a day are enough for a private portfolio once symbols are stored; the €19.99 plan adds decades of history for backfilling past purchases.

Cons:

- Failed requests (for example HTTP 404 for a mistyped symbol) count against the quota.
- Fund values are aggregated from multiple sources and may differ slightly from the official net asset value; acceptable for approximate holdings values.
- Lang & Schwarz, gettex and Tradegate are not offered; evening price moves after the XETRA close are not reflected.
- Personal plans forbid sharing, displaying or granting access to the data. A hosted service would need a custom agreement starting at €399/month, and EODHD reports commercial users to the exchanges ([commercial pricing](https://eodhd.com/commercial-pricing), [terms](https://eodhd.com/financial-apis/terms-conditions), [commercial vs personal](https://eodhd.com/financial-apis/commercial-vs-personal-license-use)).

A manual test with a free key returned EUR prices for six ETFs on XETRA and two non-ETF funds under `EUFUND`, all within the daily free quota.

### Tiingo

Pros:

- Generous limits for $30/month.

Cons:

- Exchange coverage outside the US and China is unclear; Vienna listings are unverified.
- All tiers are internal use only; displaying or sharing the data is not permitted.

### Twelve Data

Pros:

- ISIN lookup on every plan and a documented batch endpoint.
- Explicit plans for displaying data to third parties.

Cons:

- Vienna requires the Pro plan ($99/month); the free plan's three markets are not named.
- Display to third parties starts at the Venture plan ($149/month).

### Marketstack

Pros:

- Cheapest paid plan with commercial use ($9.99/month) and per-request overage pricing.

Cons:

- The free plan's 100 requests a month cover only about three securities with daily updates.
- European and Vienna coverage and ISIN support are not documented on the pages that were readable; the v2 documentation returned HTTP 404.
- "Commercial Use" is not defined publicly. The applicable APILayer subscription agreement could not be fully read, so display to end users, caching and attribution remain unclear. US exchange data is sourced from Tiingo.

## Licensing

- Personal plans everywhere permit private, non-commercial use only. Sharing an account, displaying data to other people or redistributing it is excluded.
- A self-hosted instance used by one person with that person's own provider key fits the personal terms as written. No provider explicitly addresses open-source or self-hosted software that only calls the API; confirm in writing before relying on it.
- A hosted service that shows other people their holdings values counts as displaying data to third parties. EODHD has no published plan for it, Tiingo forbids it, Twelve Data requires Venture or higher, and Marketstack's terms do not say.

## Recommendation

1. Use EODHD for a private instance: the free plan for current prices, the €19.99 plan when longer history is needed.
2. Store the provider symbol per security after an ISIN search, and request one price per security per day.
3. Let each instance configure its own provider key and keep the provider replaceable, so Ufer itself never redistributes market data.
4. Before offering Ufer as a hosted service, request written terms or quotes for display to end users (EODHD custom agreement, Twelve Data Venture, Marketstack).

Fallback: Tiingo if its coverage includes the required European listings, accepting internal-use-only terms.

## Open questions

- Whether `EUFUND` is part of EODHD's commercial plans, and the price of additional seats.
- Whether EODHD and Marketstack permit a self-hosted open-source app where each user brings a personal key.
- European coverage and ISIN support for Tiingo and Marketstack; the three free markets on Twelve Data; Financial Modeling Prep in general.
- Marketstack's definition of commercial use, display, caching and attribution terms.
