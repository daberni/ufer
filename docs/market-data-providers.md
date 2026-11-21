# Market data providers for security prices

Research notes for valuing securities holdings (stocks, ETFs and mutual funds, mostly on European venues, identified by ISIN) with daily end-of-day prices. Nothing here is implemented yet; this document records the evaluation so the decision can be revisited. Facts were read from the providers' official pages on 2026-11-21 and are linked inline; items marked **unverified** could not be confirmed from public pages. EODHD lists its prices in euros on its pricing pages.

Ufer needs two kinds of use, which providers license differently:

- **Personal use:** a self-hosted instance used by one person for their own holdings, with that person's own provider account.
- **Commercial use:** Ufer offered as a service, where the operator's provider account supplies prices that are shown to other people (for example each user's holdings value).

## Requirements

- One end-of-day price per security and day is enough; Ufer shows approximate holdings values, not a market data terminal.
- European listings in EUR (XETRA and other German venues, Vienna), plus non-ETF UCITS funds that only publish a daily net asset value.
- Lookup by ISIN when a security is first added.
- Historical prices from the date of a past purchase would be useful when a holding is created later (out of scope for now).

## Key findings

- Most providers count requests **per security**; Marketstack and Twelve Data batch endpoints save round trips, not quota. EODHD's whole-exchange bulk download is the exception: a flat 100 calls for every security on one exchange (paid plans only), while its symbol-filtered form costs 100 plus one per security. With more than about 100 securities on one exchange, the whole-exchange download is cheaper.
- The trading venue shown by a broker is only where its displayed price comes from. Holdings are held independently of the venue, so any liquid EUR listing (for example XETRA) is a valid valuation source. Prices from venues trading into the evening (Lang & Schwarz, gettex) can differ from the XETRA close by roughly a percent on volatile days.
- Mutual fund values usually lag one day because the fund's price is published the following day.
- Storing the chosen provider symbol per security (for example `VWCE.XETRA`) keeps daily updates at one request per security; ISIN search is only needed when a security is added.
- Personal plans everywhere forbid sharing an account, displaying data to other people and redistributing it. Displaying prices or derived values to other people is what separates commercial use from personal use, and it is the expensive part.

## Data coverage

| Provider | Counting | EU / Vienna | Mutual funds | ISIN |
|---|---|---|---|---|
| [EODHD](https://eodhd.com/list-of-stock-markets) | 1 call per security; whole-exchange bulk a flat 100 calls, symbol-filtered bulk 100 + 1 per security, paid plans only ([bulk](https://eodhd.com/financial-apis/bulk-api-eod-splits-dividends)) | XETRA, Frankfurt and other German venues, Vienna `VI`; not Lang & Schwarz, gettex or Tradegate | European funds under the virtual exchange `EUFUND` ([EUFUND](https://eodhd.com/exchange/EUFUND)) | Search by ISIN on all plans ([search](https://eodhd.com/financial-apis/search-api-for-stocks-etfs-mutual-funds)) |
| [Tiingo](https://www.tiingo.com/documentation/end-of-day) | Per request | "Global Securities"; European and Vienna coverage **unverified** | ETFs and mutual funds listed, European funds **unverified** | **Unverified** |
| [Twelve Data](https://twelvedata.com/exchanges) | 1 credit per symbol; `/batch` charges the sum ([batch](https://twelvedata.com/docs/advanced/batch-requests)) | Vienna listed (Pro or higher); global EOD equities from Grow | **Unverified** | `isin` parameter on all plans ([time series](https://twelvedata.com/docs/market-data/time-series)) |
| [Marketstack](https://marketstack.com/faq) | 1 request per symbol, up to 100 symbols per call | European and Vienna coverage **unverified** | **Unverified** | **Unverified** |
| Financial Modeling Prep | **Unverified** (documentation returned HTTP 403) | **Unverified** | **Unverified** | **Unverified** |
| [Polygon / Massive](https://massive.com/pricing) | – | Likely US only (**unverified**) | – | – |

Supporting services:

- [OpenFIGI](https://www.openfigi.com/api/documentation) maps ISINs to tickers and venues for free: 25 requests/minute without a key, 250 with one, 10 or 100 identifiers per request. Its terms of service were not reviewed.
- The ECB publishes free daily euro reference exchange rates, which would cover holdings priced in other currencies. Its API page returned HTTP 503 during this review (**unverified**).

Not suitable:

- Yahoo Finance via unofficial access (for example yfinance): the [terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) prohibit automated collection and building databases without permission, and commercial reuse.
- Stooq: the site returned an empty page; access and terms are **unverified**.
- Wiener Börse: a free [daily statistics CSV](https://www.wienerborse.at/en/market-data/statistics/daily-statistics/daily-statistics-download/) is published around 18:00 CET per trading day, but it covers only the equity market segments (no ETFs or funds), its columns are not documented, and the [disclaimer](https://www.wienerborse.at/rechtliches/disclaimer/) states "Eine automatisierte Abfrage ist nicht gestattet" and requires consent to use its database works. Data feeds are institutional only ([feeds](https://www.wienerborse.at/en/market-data/market-data-sales/market-data-feeds/)).

## Personal use

Each instance uses its owner's provider account; Ufer itself never redistributes data.

| Provider | Plan for personal use | Price | Quota | History | Terms |
|---|---|---|---|---|---|
| [EODHD](https://eodhd.com/pricing) | Free | €0 | 20 calls/day | 1 year | "private, non-commercial purposes"; no sharing, displaying or granting access ([terms](https://eodhd.com/financial-apis/terms-conditions)) |
| EODHD | EOD Historical | €19.99/month (€199.90/year) | 100,000 calls/day | 30+ years | Same personal terms |
| [Tiingo](https://www.tiingo.com/about/pricing) | Starter (free) | $0 | 500 symbols/month, 50 requests/hour, 1,000/day | **Unverified** | "Internal Use Only": own use, no display or sharing |
| Tiingo | Power | $30/month | 10,000 requests/hour, 100,000/day | **Unverified** | Same |
| [Twelve Data](https://twelvedata.com/pricing) | Basic (free) | $0 | 800 credits/day, 8/minute, 3 unnamed markets | **Unverified** | Internal non-display usage |
| Twelve Data | Grow / Pro | $29 / $99 per month | 55 / 610 credits/minute | **Unverified** | Personal plans; Vienna needs Pro |
| [Marketstack](https://marketstack.com/pricing) | Free | $0 | 100 requests/month | 1 year | "Non-Commercial Use" (not defined publicly) |
| Marketstack | Basic | $9.99/month | 10,000 requests/month, then about $0.004 each | 10 years | "Commercial Use" (not defined publicly) |

Assessment:

- **EODHD** is the only provider whose public pages confirm German venues, Vienna, European funds and ISIN search on the free plan. A manual test with a free key returned EUR prices for six ETFs on XETRA and two non-ETF funds under `EUFUND` within the daily quota. Failed requests also count against the quota, and fund values are aggregated from several sources (acceptable for approximate values).
- **Tiingo** has generous limits, but its coverage of European listings is unverified.
- **Twelve Data** needs the Pro plan ($99/month) for Vienna.
- **Marketstack's** free plan covers only about three securities with daily updates, and its European coverage is unverified.

Tiingo's [Developer Program](https://www.tiingo.com/documentation/appendix/developers) explicitly covers software where each user supplies their own Tiingo token: no permission is needed, but Tiingo asks to be notified, requires clear attribution as the data source, forbids redistribution, programmatic logins and tracking of users' API metadata. The other providers do not address this model; their personal terms as written fit a single person using their own key for their own holdings, which should be confirmed in writing before relying on it.

**Recommendation:** EODHD, free plan for current prices, €19.99 plan when longer history is needed for backfilling past purchases. Fallback: Tiingo, whose Developer Program licenses the bring-your-own-key model, if its coverage includes the required European listings.

## Commercial use

The operator's provider account supplies prices that other people see, directly or as derived holdings values. That is "displaying" data to third parties, which every personal plan excludes.

| Provider | Commercial offering | Price | Display to end users |
|---|---|---|---|
| [EODHD](https://eodhd.com/commercial-pricing) | Internal (single company) | €399/month (€3,990/year), 1 seat, 100,000 calls/day, all datasets | Not allowed: "Displaying it or sharing it with people outside your company is not permitted" |
| EODHD | Enterprise | €2,499/month, 5 seats, unlimited calls, "Data services agreement" | Contents of the agreement not published (**unverified**) |
| EODHD | Custom | From €399/month on request | By individual agreement |
| [Tiingo](https://www.tiingo.com/about/pricing) | Power, internal commercial | $50/month | Not allowed ("Internal Use Only"); redistribution via sales |
| [Twelve Data](https://twelvedata.com/pricing-business) | Venture | $149/month, 610 credits/minute | "External display data access" |
| Twelve Data | Enterprise | Custom | "External distribution market data" |
| [Marketstack](https://marketstack.com/pricing) | Basic and above | From $9.99/month | "Commercial Use" is not defined; display, caching and attribution terms are not public. The APILayer subscription agreement could not be fully read (**unverified**) |

Further constraints:

- EODHD reports commercial users of exchange data to the exchanges ([commercial pricing](https://eodhd.com/commercial-pricing), [commercial vs personal](https://eodhd.com/financial-apis/commercial-vs-personal-license-use)).
- Marketstack sources US exchange data from Tiingo, whose own terms are internal use only.
- Twelve Data's ISIN data in responses is a separate add-on (from $24,000/year for internal use); looking up instruments by ISIN works on all plans.

Assessment:

- **Twelve Data Venture** is the only published plan that explicitly allows displaying data to third parties. Its European fund coverage is unverified.
- **EODHD** fits best on data, but display to end users requires a custom agreement (from €399/month, likely more).
- **Marketstack** would be cheapest if "Commercial Use" includes display to end users; that needs written confirmation.
- **Tiingo** is not an option for display to end users without a separate redistribution agreement.

**Recommendation:** Before offering Ufer as a service, request written terms or quotes for displaying holdings values to end users from EODHD (custom agreement), Twelve Data (Venture) and Marketstack (Basic or Professional), and compare them against expected user numbers. Until then, keep the provider replaceable so the commercial choice does not affect the personal setup.

## Product implications

1. Store the provider symbol per security after an ISIN search, and request one price per security per day; with EODHD on a paid plan, switch to one whole-exchange bulk download per exchange once that is cheaper.
2. Keep the provider behind a replaceable interface and its key per instance, so personal instances use their owner's key and a hosted service can use a commercially licensed account.
3. Load historical prices from the date of a past purchase when a holding is created; this needs a plan with enough history (EODHD €19.99 for personal use).

## Open questions

- Whether EODHD and Marketstack permit a self-hosted open-source app where each user brings a personal key (Tiingo does, via its Developer Program).
- What EODHD's Enterprise "Data services agreement" and custom agreements cost and allow for display to end users; whether `EUFUND` is part of the commercial plans; the price of additional seats.
- Marketstack's definition of commercial use, display, caching and attribution terms.
- European coverage and ISIN support for Tiingo and Marketstack; the three free markets on Twelve Data and its European fund coverage; Financial Modeling Prep in general.
