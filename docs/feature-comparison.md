# Feature comparison and development status

Updated: **2026-11-15** · Working product name: **Ufer** · Version: `0.1.0`

This document tracks current capabilities, explicit limitations, accepted priorities, and readiness for a possible open-source release. It contains no personal account inventory. Architecture and commercial direction are described in [product-direction.md](product-direction.md).

## Positioning and build-versus-adopt

Ufer currently provides an account and net-worth dashboard, booked transactions, rules, manual valuations, and bank synchronization through Enable Banking. It is not yet a full replacement for a mature personal finance product.

**Existing alternatives already synchronize bank accounts.** Bank sync alone is not a reason to build a new application. The proposed product direction combines a focused mobile UI, visible transaction provenance, configurable imports, security-level investment tracking, and self-hosted or managed operation. Much of that direction is still a requirement rather than shipped functionality. Evaluate the alternatives against those requirements before treating further custom development as necessary.

| Product | Focus | Deployment / license |
| --- | --- | --- |
| Ufer | Account aggregation, cash flow, and wealth overview; planned provenance and securities workflow | Docker/NAS and Vercel configurations; SQLite/libSQL today, PostgreSQL planned; no project license selected |
| [Buxfer](https://www.buxfer.com/features/) | Broad personal finance, budgets, forecasting, investments | Hosted service; features depend on plan |
| [Actual Budget](https://actualbudget.org/docs/getting-started/envelope-budgeting/) | Envelope/tracking budgeting, transaction management, reporting | Self-hosting; [MIT license](https://github.com/actualbudget/actual/blob/master/LICENSE.txt) |
| [Firefly III](https://github.com/firefly-iii/firefly-iii#features) | Double-entry personal finance, rules, budgets, recurring entries | Self-hosting/Docker; AGPLv3 |
| [Sure](https://sure.am/) | Wealth, transactions, investments, and budgeting | [Self-hosting/Docker; AGPLv3, community fork of Maybe](https://github.com/we-promise/sure#hosting-sure) |

Low resource use is a Ufer design goal; there is no comparative RAM/CPU benchmark. Competitor capabilities below are based on official documentation, not a fresh installation or a claim that every institution works. Advertised investment tracking also does not establish reliable coverage for a particular broker, venue, or instrument.

## Status legend

| Status | Meaning, applied consistently across products |
| --- | --- |
| **Yes** | The capability is implemented or documented; explicit limitations still apply |
| **Partial** | A usable subset exists; missing operations are stated |
| **No** | Not implemented in Ufer, or explicitly unsupported in a cited product source |
| **Experimental** | The product documents the feature as experimental |
| **Not assessed** | The available evidence does not establish this capability; this is not a claim that it is absent |

Implementation and verification are separate. A Yes in Ufer's column means the code exists; live-bank and hosting validation are recorded in the evidence section. A competitor's Yes likewise does not mean it was tested against a specific institution.

## Feature matrix

### Aggregation and everyday transactions

| Capability | Ufer | Buxfer | Actual Budget | Firefly III |
| --- | --- | --- | --- | --- |
| Bank balances and booked transactions | **Yes:** Enable Banking | **Yes** [B1] | **Yes:** multiple providers [A1] | **Yes:** Data Importer [F2] |
| Connect / reauthorize bank accounts | **Yes:** institution authorization and reconnect flow | **Yes** [B2] | **Yes** [A2] | **Yes:** importer authorization [F4] |
| Sync while the browser is closed | **Yes:** scheduler/cron integration; required for every deployment | **Yes:** bank-dependent automatic refresh [B2] | **Partial:** built-in interval sync requires an open app; external automation can be added [A1] | **Yes:** importer CLI/API automation [F2] |
| Current balances and monthly income/expenses | **Yes:** separate currency totals | **Yes** [B1] | **Yes:** cash-flow/net-worth reports [A3] | **Yes:** income/expense reports [F1] |
| Cross-account search and filters | **Yes:** text, account, category, month/all months; 50 rows per page | **Yes** | **Yes** [A2] | **Not assessed** |
| Automatic categorization and manual correction | **Yes:** keyword/RE2 rules, priorities, preserved manual categories | **Yes** [B1] | **Yes** [A4] | **Yes** [F1] |
| Rule and category management | **Partial:** create; enable/disable/apply rules; no edit/delete | **Yes** [B1] | **Yes:** rule management [A4] | **Yes:** rule management [F1] |
| Manual transaction creation and field editing | **Partial:** category editing only; create/date/amount/payee/description/delete absent | **Yes** [B1] | **Yes** [A5] | **Yes:** bookkeeping; exact editing operations not separately assessed [F1] |
| Split transactions | **No:** required | **Not assessed** | **Yes** [A6] | **Not assessed** |
| CSV imports with selectable field mapping | **Partial:** fixed schema only; configurable mapping required | **Yes:** statement upload; mapping details not assessed [B1] | **Yes:** CSV mapping and other formats [A5] | **Yes:** CSV/CAMT and mapping through importer [F2] |
| Visible per-import provenance | **Partial:** provider reference and account link; no complete import-run trail | **Not assessed** | **Not assessed** | **Not assessed** |
| Mobile use | **Yes:** responsive cards, bottom navigation and touch forms | **Yes:** mobile entry [B1] | **Yes:** mobile web interaction [A1] | **Not practically tested here** |

### Planning, investments, and data control

| Capability | Ufer | Buxfer | Actual Budget | Firefly III |
| --- | --- | --- | --- | --- |
| Category budgets and spending limits | **No** | **Yes** [B1] | **Yes:** core envelope/tracking budgeting [A7] | **Yes** [F1] |
| Recurring transactions / bills | **No** | **Yes:** reminders [B1] | **Yes:** schedules [A8] | **Yes** [F1] |
| Cash-flow forecast | **No:** current charts show history | **Yes** [B1] | **Experimental:** balance forecast [A3] | **Not assessed** |
| Long-term / retirement planning | **No** | **Yes** [B1] | **Yes:** crossover report; Monte Carlo experimental [A3] | **Not assessed** |
| Investment account total value | **Yes:** manual/CSV valuations, cash separate | **Yes** [B3] | **Yes:** off-budget balances in net worth [A3] | **Partial:** generic asset-account representation [F3] |
| Securities, quantities, venue, prices and performance | **No:** ISIN/venue/holdings and later market prices are required | **Yes:** advertised holdings/performance; institution-specific reliability not established [B3] | **Not assessed:** no equivalent holdings module established by reviewed sources | **No:** no dedicated investment tracking [F3] |
| Historical net-worth chart | **Partial:** snapshots stored; chart not implemented, required | **Yes:** existing product capability; independently re-tested here: no | **Yes** [A3] | **Not assessed** |
| Manual asset / liability valuations | **Yes:** dated balances | **Yes** [B2] | **Yes:** assets/debts in net worth [A3] | **Yes:** asset accounts [F3] |
| Multiple currencies / automatic FX totals | **Partial:** separate currencies, no exchange rates or cross-currency total | **Yes:** daily exchange rates [B1] | **Partial:** workarounds; native multi-currency not supported per documentation [A9] | **Yes:** currencies; rate automation not assessed [F1] |
| Tags and nested categorization | **No:** one flat category per booking | **Yes** [B1] | **Yes:** tags [A2] | **Yes:** categories/tags [F1] |
| Household sharing / roles | **No:** one shared password | **Yes** [B1] | **Not assessed** | **Not assessed** |
| End-to-end encryption of financial data | **No:** bank sessions encrypted at rest, financial database not E2EE | **Not assessed** | **Yes:** optional budget E2EE, excluding bank tokens [A11] | **Not assessed** |
| UI export / backup restoration | **No:** manual DB/key backup documented | **Yes:** API/backups [B1] | **Yes:** budget export; restore details not assessed here [A10] | **Partial:** REST API; restore not assessed [F1] |

**Missing management operations:** rule names, patterns, modes, priorities and target categories cannot be edited; rules cannot be deleted; categories cannot be renamed or deleted. Account rename/archive and explicit connection removal also need implementation. The current limitation is MVP scope, not a rule that imported financial data must remain uneditable.

**Sure:** its [product page](https://sure.am/) documents asset/debt tracking, stocks/crypto, multiple currencies, CSV, transaction editing, rules, and category budgets. Its [repository](https://github.com/we-promise/sure#hosting-sure) documents browser, desktop, mobile and API access; development requirements include PostgreSQL and Redis. Exact regional bank coverage, import compatibility and resource use have not been validated here.

## Bank providers and the separate importer

| Product | Documented providers / integration |
| --- | --- |
| Ufer | Enable Banking only |
| [Buxfer](https://www.buxfer.com/features/sync/) | Bank sync is present. Public documentation names Yodlee and Salt Edge; this does not establish that Buxfer itself uses Enable Banking. |
| [Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/) | Enable Banking (Europe, experimental integration), GoCardless Bank Account Data (Europe, no new accounts), SimpleFIN Bridge (North America), Akahu (New Zealand), Pluggy.ai (Brazil) |
| [Firefly III Data Importer](https://github.com/firefly-iii/data-importer#about-the-data-importer) | Separate companion application for files and provider integrations; [Enable Banking is documented](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md) |

A **separate Data Importer** means Firefly III's core application is not the component that fetches bank data. A companion process/container connects to the provider or reads files, then writes into Firefly III through its API. It needs its own configuration and automation. Ufer currently includes provider access, imports and its REST API in one application, with scheduling supplied by Docker or the host platform.

Do not equate a provider's institution directory with proven account coverage. Consent durations and available history depend on the institution. Restricted own-account provider access is also different from permission to operate a paid multi-customer service; see the [commercial direction](product-direction.md#free-self-hosting-and-paid-managed-hosting).

## Current implementation and evidence

| Area | Implementation / verification boundary |
| --- | --- |
| UI | [Dashboard](../src/components/dashboard.tsx), [CSS](../src/app/globals.css), [viewport](../src/app/layout.tsx): responsive cards and forms; desktop table retained |
| Domain data | [API](../src/app/api/%5B...path%5D/route.ts), [schema](../src/lib/db.ts), [storage](../src/lib/store.ts), [amounts](../src/lib/money.ts): integer minor units, account-scoped references and manual category preservation |
| Banking | [Provider client](../src/lib/enable-banking.ts), [sync](../src/lib/sync.ts), [callback](../src/app/api/banking/callback/route.ts): sandbox authorization completed, booked transactions persisted and repeat sync checked without additional duplicates |
| Imports / rules | [CSV](../src/lib/import.ts), [rules](../src/lib/rules.ts): fixed schemas; 1 MB/10,000-row limits; RE2/keyword matching; no field-mapping UI or full transaction overrides |
| Protection | [Security](../src/lib/security.ts): password/session/origin checks, sign-in throttling, encrypted bank sessions; no tenant model, roles, 2FA, or financial-data E2EE |
| Deployment | [Compose](../compose.yaml), [Dockerfile](../Dockerfile), [scheduler](../scripts/scheduler.mjs), [Vercel config](../vercel.json): local x86 container checks completed; actual NAS/Vercel and their unattended schedules not yet accepted |
| Behavior checks | [Tests](../tests/finance.test.ts) cover imports, money, rules, reconnects, environment isolation, leases, sessions, pagination and callback reuse; [CI](../.github/workflows/ci.yml) runs type check, tests and build |
| Responsive checks | All five views checked in Chrome emulation at 320, 360, 390, 430, 768, 844 and desktop 1440 pixels; no page overflow; forms usable at 400-pixel height |
| Not verified | Live institutions, physical phones/Safari and bank-app redirects, large histories, production hosting, restore from backup, PostgreSQL, multi-tenant SaaS |

No account inventory or personal bank acceptance results are maintained in this repository. Use synthetic fixtures for examples and privately managed operational records for real deployments.

## Tracked work

Check an item only when its acceptance criterion is met and evidence is recorded. Requirements are distinct from completed implementation. The following priorities incorporate the product review.

### Existing foundation

- [x] **BASE-01** Accounts, latest net worth and monthly cash flow with currency isolation.
- [x] **BASE-02** End-to-end Enable Banking sandbox connection and repeat-sync deduplication check.
- [x] **BASE-03** Keyword/RE2 categorization, priorities and preserved manual category changes.
- [x] **BASE-04** Manual valuations and documented fixed-schema CSV imports.
- [x] **BASE-05** Responsive smartphone UI verified in Chrome emulation; physical device checks remain open.

### Required reliability and data workflows

- [ ] **E-01 · Live bank acceptance:** verify consent, balances, booked transactions, repeat sync and reauthorization with supported production institutions; publish only generic compatibility results with authorization.
- [ ] **E-02 · Configurable CSV:** selectable formats and fields, preview, reusable profiles, stable reference mapping, overlap reconciliation and a visible import report. A dedicated Buxfer migration assistant is not a priority.
- [ ] **E-03 · Backup / restore:** restore database and keys on a fresh instance, verify results, then provide consistent automated backups.
- [ ] **E-04 · Provider-aware persistence:** shared domain repositories, explicit SQLite/libSQL and PostgreSQL adapters, versioned migrations and equivalent behavioral checks. PostgreSQL is not supported yet.
- [ ] **E-05 · Unattended deployment:** include and verify daily sync for each supported host, visible failures/recovery, real mobile keyboards and bank-app redirects; no browser needs to stay open.

### Required product capabilities

- [ ] **K-01 · Editing, provenance and splits:** manual create/edit/delete; immutable source identity, per-import run linkage and explicit overrides; suppression of deleted imports; split allocations sum exactly to the original and are never double counted.
- [ ] **K-02 · Complete management:** edit/delete rules and categories, rename/archive accounts, and explicitly disconnect bank links while preserving intended history.
- [ ] **K-03 · Securities:** ISIN, venue/MIC, symbol/currency, exact holdings, trades and separate settlement cash; manual prices first, later explicit market-data adapters with timestamps/licensing and predictable resync behavior.
- [ ] **K-04 · Planning:** category budgets/limits, recurring entries, reminders and forecasting; agree on the planning model before implementation.
- [ ] **K-05 · Historical wealth:** net-worth and portfolio charts from dated snapshots/valuations, clearly distinguishing missing observations, price updates and optional FX conversion.

### Before an open-source or managed release

- [ ] **OSS-01 · License and commercial eligibility:** choose the project license, review dependency/assets notices, and establish commercial banking/market-data rights. Free self-hosting plus paid managed hosting is the intended model, not an implemented offering.
- [ ] **OSS-02 · Publication privacy:** scan the exact Git tree and history for secrets and real financial data; exclude local environment files, keys, databases, exports, host paths and personal account inventories. Initial content is prepared with generic English examples.
- [ ] **OSS-03 · Fresh setup and demo:** verify instructions from a fresh checkout, supply synthetic demo data without bank credentials, and document supported Node/container configurations.
- [ ] **OSS-04 · Contribution and security process:** add contribution/security policies and a reporting channel; maintain automated checks and dependency review. Existing safeguards are not a completed security audit.
- [ ] **OSS-05 · Managed-hosting readiness:** tenant isolation, identity/authorization, durable scheduled jobs, operational secrets, backups/monitoring, billing and data lifecycle; verify upgrades and obtain explicit approval for a public release.

## Sources and maintenance

Primary sources checked on 2026-11-15. Documentation can lead stable releases; experimental features are labeled. User-confirmed existing product capabilities are distinguished from fresh independent testing. No pricing, institution-count claims, or performance benchmarks form the basis of this comparison.

| Reference | Source |
| --- | --- |
| B1 | [Buxfer features](https://www.buxfer.com/features/) |
| B2 | [Buxfer sync and reauthorization](https://www.buxfer.com/features/sync/) |
| B3 | [Buxfer investments](https://www.buxfer.com/features/investments/) |
| A1 | [Actual bank sync and providers](https://actualbudget.org/docs/advanced/bank-sync/) |
| A2 | [Actual Enable Banking setup](https://actualbudget.org/docs/advanced/bank-sync/enable-banking/), including navigation to transaction filters/tags |
| A3 | [Actual reports](https://actualbudget.org/docs/reports/) |
| A4 | [Actual rules](https://actualbudget.org/docs/budgeting/rules/) |
| A5 | [Actual imports and manual transactions](https://actualbudget.org/docs/transactions/importing/) |
| A6 | [Actual split transactions](https://actualbudget.org/docs/transactions/split-transactions/) |
| A7 | [Actual envelope budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting/), [settings](https://master.www.actualbudget.org/docs/settings/) |
| A8 | [Actual schedules](https://actualbudget.org/docs/schedules/) |
| A9 | [Actual multi-currency limits](https://actualbudget.org/docs/budgeting/multi-currency/) |
| A10 | [Actual installation and exports](https://master.www.actualbudget.org/docs/install/) |
| A11 | [Actual sync and encryption](https://master.www.actualbudget.org/docs/getting-started/sync/) |
| F1 | [Firefly III features](https://github.com/firefly-iii/firefly-iii#features) |
| F2 | [Firefly III Data Importer](https://github.com/firefly-iii/data-importer#about-the-data-importer) |
| F3 | [Firefly III maintainer answers on investment accounts](https://github.com/orgs/firefly-iii/discussions/10190) |
| F4 | [Firefly III Enable Banking tutorial](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md) |

Update this document in the same change as a capability change: revise the status and limitation, update the tracked item when justified, record evidence, and update the date. Configuring an endpoint or seeing an institution name is not production validation.

[B1]: https://www.buxfer.com/features/
[B2]: https://www.buxfer.com/features/sync/
[B3]: https://www.buxfer.com/features/investments/
[A1]: https://actualbudget.org/docs/advanced/bank-sync/
[A2]: https://actualbudget.org/docs/advanced/bank-sync/enable-banking/
[A3]: https://actualbudget.org/docs/reports/
[A4]: https://actualbudget.org/docs/budgeting/rules/
[A5]: https://actualbudget.org/docs/transactions/importing/
[A6]: https://actualbudget.org/docs/transactions/split-transactions/
[A7]: https://actualbudget.org/docs/getting-started/envelope-budgeting/
[A8]: https://actualbudget.org/docs/schedules/
[A9]: https://actualbudget.org/docs/budgeting/multi-currency/
[A10]: https://master.www.actualbudget.org/docs/install/
[A11]: https://master.www.actualbudget.org/docs/getting-started/sync/
[F1]: https://github.com/firefly-iii/firefly-iii#features
[F2]: https://github.com/firefly-iii/data-importer#about-the-data-importer
[F3]: https://github.com/orgs/firefly-iii/discussions/10190
[F4]: https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md
