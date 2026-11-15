# Feature comparison and development status

Updated: **2026-11-15** · Working product name: **Ufer** · Version: `0.1.0`

This document tracks implemented capabilities, limitations, and accepted priorities. The [functional review](functional-review.md) explains workflows, release boundaries, source evidence, practical checks, and the build-versus-adopt conclusion. Architecture and commercial requirements are in [product-direction.md](product-direction.md). No personal account inventory is included.

## Positioning and build-versus-adopt

**Ufer currently has substantially less functionality than all four established alternatives.** Bank sync, mobile access, editable imported transactions, configurable imports, and historical wealth are already available elsewhere. Sure also covers holdings, trades, market prices, and preservation of manual corrections. This combination is not an established gap in the market.

Actual is a strong candidate for budgeting and everyday bookkeeping; Sure is the closest documented match for an integrated money-and-investments dashboard. Firefly III offers extensive bookkeeping and automation, without a dedicated securities engine. Buxfer remains a broad hosted reference. These are fit assessments, not completed acceptance tests. Ufer targets everyday users through automatic bank synchronization, a consolidated view across institutions, simple hosted onboarding, useful report defaults and optional dashboard customization. File imports/exports support history, unsupported sources and portability; they are not the primary everyday workflow. Basic tagging and budgets alone are not the proposed reason to subscribe. That is a usability direction to validate, rather than a claim that existing financial functionality is missing.

| Product / reviewed release | Focus | Deployment / license |
| --- | --- | --- |
| Ufer `0.1.0` | Aggregation, cash flow, rules, manual valuations; early MVP | Docker/NAS configuration; verified Vercel sandbox deployment on Node 26; SQLite/libSQL; no project license selected |
| [Buxfer](https://www.buxfer.com/features/) · hosted, no public release pin | Broad personal finance, budgets, forecasts, investments | Hosted subscription; capabilities depend on plan |
| [Actual Budget 26.11.0](https://github.com/actualbudget/actual/releases/tag/v26.11.0) | Budgeting, transaction management, reports, local-first use | Self-hosted Node server; [MIT](https://github.com/actualbudget/actual/blob/master/LICENSE.txt) |
| [Firefly III 6.7.9](https://github.com/firefly-iii/firefly-iii/releases/tag/v6.7.9) + [Importer 2.3.5](https://github.com/firefly-iii/data-importer/releases/tag/v2.3.5) | Double-entry bookkeeping, rules, budgets, recurring entries | PHP application, database, optional companion importer and cron; AGPLv3 |
| [Sure 0.7.6-hotfix.1](https://github.com/we-promise/sure/releases/tag/v0.7.6-hotfix.1) | Wealth, transactions, securities, category budgets | Rails web/worker, PostgreSQL, Redis; AGPLv3 |

Low resource use is a Ufer goal, not a measured advantage. No comparative CPU/RAM, performance, or security benchmark was conducted. NAS deployment is plausible for the self-hosted alternatives; their normal persistent-server stacks are not drop-in Vercel deployments.

## Status and evidence

| Status | Meaning for every product |
| --- | --- |
| **Yes** | Implemented or officially documented; the stated scope and evidence limits apply |
| **Partial** | A subset exists; the missing operation is stated |
| **No** | Not implemented in Ufer, or explicitly unsupported in a cited source |
| **Experimental / Preview** | The source labels the feature accordingly |
| **Unverified** | The reviewed evidence does not establish the exact capability; this does not mean absent |

Status is separate from verification: **runtime-observed**, **source-inspected**, **documented**, and **not tested** are distinct. Actual 26.11.0 was started locally and its synthetic demo inspected. Sure's stable schema/models and scheduler were inspected; its local launch failed during image retrieval because of a host credential-helper error. Firefly III and Buxfer were assessed through official sources, not fresh live-bank tests.

Sure's rolling documentation is explicitly marked **draft** and can lead its stable release. Its documentation-derived cells are not promises that every described detail shipped in the pinned image. The [review evidence](functional-review.md#verification-record) states what was pinned or observed. No provider directory or advertised broker integration counts as successful institution acceptance.

**Product decision:** continue Ufer in Node/React; no Sure fork. See [ADR 001](adr/decisions/001-continue-ufer.md). The current source implements individual users and memberships in one constrained financial workspace. The [architecture](architecture.md) still proposes full customer separation and SSO; these are not implemented.

## Feature matrix

### Aggregation and everyday transactions

| Capability | Ufer | Buxfer | Actual Budget | Firefly III | Sure |
| --- | --- | --- | --- | --- | --- |
| Bank balances and transactions | **Yes:** Enable Banking; booked only | **Yes** [B2] | **Yes:** several providers; Enable Banking experimental [A1] | **Yes:** companion importer [F2] | **Yes:** Enable Banking and others [S1] |
| Connect and reauthorize | **Yes:** sandbox verified; live banks open | **Yes** [B2] | **Yes:** provider setup [A1] | **Yes:** importer setup [F4] | **Yes:** session/reconnect workflow [S1] |
| Bank linking without user-supplied provider credentials | **Partial:** operator environment setup; sandbox consent flow, no managed service | **Yes:** hosted linking [B2] | **Partial:** provider setup before consent [A1] | **Partial:** importer/provider configuration [F4] | **Partial:** reviewed self-hosted UI asks for application credentials before consent [S1] |
| Sync with browsers closed | **Yes:** scheduler configured; target hosting not accepted | **Yes:** provider-dependent [B2] | **Yes via external API job:** built-in interval requires open app [A12] | **Yes via importer CLI/API + scheduler** [F2] | **Yes:** worker scheduler in stable source [S8] |
| Balances, income and spending | **Yes:** separate currency totals | **Yes** [B1] | **Yes:** reports [A3] | **Yes:** reports [F8] | **Yes:** wealth/cash-flow views [S9] |
| Search and filters | **Yes:** text, account, category; month or all months shared with the overview; paginated | **Yes** [B1] | **Yes:** transaction filters [A5] | **Yes:** transaction search [F14] | **Yes:** transaction filters [S2] |
| Categorization and rule management | **Partial:** rules create/toggle/apply; category create/edit (name, color); no rule edit/delete or category delete | **Yes** [B1] | **Yes:** editable rules and payee learning [A4] | **Yes:** grouped rules and multiple actions [F6] | **Yes:** conditions, order, stop-processing [S2] |
| Manual entries and full field editing | **Partial:** category only | **Yes** [B1] | **Yes:** register/API [A12] | **Yes:** create/edit/delete [F5] | **Yes:** single/bulk editing [S2] |
| Split transactions | **No:** required | **Yes:** allocated tags [B4] | **Yes:** parent/children [A6] | **Yes:** split journals [F5] | **Yes:** split groups [S2] |
| Configurable CSV imports | **Partial:** one fixed schema | **Partial evidence:** CSV/Excel yes; mapping profiles unverified [B5] | **Yes:** field/date/delimiter options [A5] | **Yes:** importer mapping/configuration [F2] | **Yes:** mapping, preview, reusable setup [S3] |
| Reimport reconciliation / deduplication | **Partial:** account references; cross-source matching absent | **Yes:** matching workflow [B2] | **Yes:** IDs and fallback matching [A5] | **Yes:** import hashes/external IDs [F9] | **Partial:** provider identities; CSV/feed overlap not guaranteed [S1], [S3], [S7] |
| Provenance and manual edits across resync | **Partial:** source reference; no batch trail or field overrides | **Partial evidence:** sync source/matching; full field history unverified [B2] | **Partial evidence:** imported identity/matching; full source-versus-override audit unverified [A5] | **Partial:** import tags/hash; field-level protection unverified [F9], [F10] | **Yes:** source IDs and manual field locks; full audit requirement not accepted [S2], [S7] |
| Mobile access | **Yes:** responsive UI; emulation checked | **Yes:** mobile access [B1] | **Yes:** mobile web; physical phone not tested [A13] | **Partial evidence:** web access; phone workflows not tested | **Yes:** web/mobile clients; native feature parity unverified [S10] |

### Planning, investments, and data control

| Capability | Ufer | Buxfer | Actual Budget | Firefly III | Sure |
| --- | --- | --- | --- | --- | --- |
| Category budgets and rollover | **No** | **Yes:** budgets [B1] | **Yes:** envelope/tracking model [A7] | **Yes:** period limits and auto-budget variants [F7] | **Yes:** category limits; positive-surplus rollover [S4] |
| Recurring entries / bills | **No** | **Yes:** reminders [B1] | **Yes:** schedules [A8] | **Yes:** recurring entries; cron needed [F11] | **Yes:** recurring transactions [S11] |
| Cash-flow forecasts | **No:** historical charts only | **Yes** [B1] | **Experimental:** balance forecast [A3] | **Unverified:** no equivalent assessed end to end | **Partial evidence:** bill/budget planning; equivalent forecast unverified [S11] |
| Long-term planning | **No** | **Yes:** planning [B1] | **Yes:** crossover; Monte Carlo experimental [A3] | **Partial:** savings goals/piggy banks, not equivalent retirement simulation [F1] | **Partial:** goals; equivalent retirement simulation unverified [S9] |
| Customizable report dashboards / widgets | **No:** fixed dashboard; widget editor planned | **Unverified:** exact layout editing | **Yes:** multiple configurable dashboards and report widgets; drag/resize not separately tested [A3] | **Partial:** configurable reports; free widget layout unverified [F8] | **Yes, source-inspected:** predefined dashboard widgets can be reordered, shown/hidden and sized with presets; runtime not tested [S14] |
| Investment account total value | **Yes:** manual/CSV balance | **Yes** [B3] | **Yes:** off-budget balance in net worth [A3] | **Partial:** asset balance, no securities engine [F3] | **Yes:** holdings and balances [S5] |
| Securities, quantities and trades | **No:** required | **Yes:** documented portfolio functionality; broker acceptance unverified [B3] | **Unverified:** no native holdings/trade ledger established | **No:** dedicated tracking unsupported [F3] | **Yes:** securities, holdings, trades, cost basis [S5], [S7] |
| Instrument identity and venue | **No:** flexible identifier + venue combinations required | **Unverified:** exact ISIN/venue workflow | **Unverified:** no equivalent module established | **No:** no securities module [F3] | **Yes:** ticker + MIC; alternative identifiers can be evaluated [S7] |
| Market prices and performance | **No** | **Yes:** advertised prices/gains/allocation [B3] | **Unverified:** simulations are not holding valuation | **No:** dedicated portfolio engine [F3] | **Yes:** quote providers/cost basis; calculation acceptance not tested [S5], [S6] |
| Historical net worth | **Partial:** snapshots; no chart | **Yes:** documented/existing capability [B1] | **Yes:** net-worth reports [A3] | **Partial evidence:** balance-history reports; exact net-worth chart unverified [F8] | **Yes:** wealth history [S9] |
| Manual assets and liabilities | **Yes:** dated balances | **Yes** [B2] | **Yes:** off-budget accounts [A3] | **Yes:** asset/liability bookkeeping [F1] | **Yes:** asset/debt accounts [S9] |
| Native multi-currency and FX | **Partial:** separate totals; no conversion | **Yes** [B1] | **No:** native model unsupported; experimental workaround [A9] | **Yes:** currencies; rate setup not tested [F12] | **Yes:** currencies and market-data FX [S6] |
| Tags and category hierarchy | **No:** one flat category | **Yes** [B1] | **Yes:** category groups and tags [A12] | **Partial:** categories/tags; nesting not established [F1] | **Yes:** categories/subcategories and tags [S2], [S4] |
| Sharing and permissions | **Partial:** individual users in one shared workspace; operator enrollment and active membership checks; no separate customer workspaces or fine-grained permissions; hosted cutover pending | **Yes:** access control/IOUs [B1] | **Yes:** OIDC, Basic/Admin and budget access [A14] | **Unverified:** exact collaboration/access model | **Yes:** account-level sharing permissions [S12] |
| Local-first / financial-data E2EE | **No:** bank-session encryption only | **Unverified:** no equivalent established | **Yes:** local-first; optional budget E2EE excludes bank tokens [A11] | **Unverified:** no equivalent established | **Unverified:** no equivalent established |
| Export and restore | **No UI:** manual database/key backup | **Yes:** API/backups [B1] | **Yes:** budget export and restore workflow [A10], [A15] | **Partial:** CSV/API exports; full restore requires database backup [F13] | **Yes:** data export; stable release includes instance backup/restore [S3], [S13] |

**Ufer management gaps:** rule editing/deletion, category deletion, account rename/archive and explicit disconnection remain open. Editing source-derived data is a product requirement; the current restriction is MVP scope. Planned work does not count as a capability.

## Bank providers and the separate importer

| Product | Documented integrations relevant to this review |
| --- | --- |
| Ufer | Enable Banking only; sandbox authorization and repeat sync checked |
| [Buxfer](https://www.buxfer.com/features/sync/) | Yodlee and Salt Edge; provider presence does not establish every institution works |
| [Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/) | Enable Banking (Europe, experimental), GoCardless (Europe, no new accounts), SimpleFIN (North America), Akahu (New Zealand), Pluggy (Brazil) |
| [Firefly III Data Importer](https://github.com/firefly-iii/data-importer) | Companion application for files and bank-provider imports; [Enable Banking tutorial](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md) |
| [Sure](https://docs.sure.am/providers/enable-banking) | Enable Banking; rolling docs also list providers such as SimpleFIN, Plaid and Akahu; exact stable support and regional eligibility must be checked per adapter |

Firefly III's **Data Importer** is a separate component/container. It fetches bank data or reads files, then writes into the finance application through its API. It needs provider credentials, import configuration and a scheduled trigger; installing Firefly III core alone does not configure automatic bank imports.

Actual 26.11.0's built-in interval sync runs while the app is open. Its [Node API](https://actualbudget.org/docs/api/reference/#runbanksync) exposes `runBankSync`, allowing an external scheduled process without an open browser. That is extra deployment configuration, not an inherently missing capability. Sure's pinned worker initializer registers automatic sync and market-data schedulers [S8].

All products still depend on provider eligibility, institution endpoints, consent, and available history. Sure's current Enable Banking guide lists a limitation for decoupled/separate-device authorization [S1]; treat the actual bank's redirect/SCA path as an acceptance criterion. Restricted personal provider access is not a commercial multi-customer agreement; see [commercial requirements](product-direction.md#free-self-hosting-and-paid-managed-hosting).

## Current implementation and evidence

| Area | Implementation / verification boundary |
| --- | --- |
| UI | [Dashboard composition](../src/features/dashboard/dashboard.tsx), [component styles](../src/features/dashboard/dashboard.module.css), [global base](../src/app/globals.css), [viewport](../src/app/layout.tsx): responsive cards and forms; desktop table retained; [Ufer identity](branding/README.md) integrated into sidebar, login, footer and Next.js browser/touch metadata |
| Domain data | [HTTP boundary](../src/server/http/respond.ts), [changesets](../drizzle/sqlite/0000_initial_schema.sql), [storage](../src/features/transactions/server/transaction-repository.ts), [amounts](../src/lib/money.ts): integer minor units, account-scoped references and manual category preservation; [Problem Details](http-errors.md) with correlated trace IDs, user validation (422) and rejected provider data (502) |
| Banking | [Provider client](../src/features/banking/server/enable-banking-client.ts), [sync service](../src/features/banking/server/sync-service.ts), [sync repository](../src/features/banking/server/sync-repository.ts), [callback](../src/app/api/banking/callback/route.ts): sandbox authorization completed, booked transactions persisted and repeat sync checked without additional duplicates; services no longer execute SQL |
| Imports / rules | [CSV](../src/lib/import.ts), [rules](../src/lib/rules.ts): fixed schemas; 1 MB/10,000-row limits; RE2/keyword matching; no field-mapping UI or full transaction overrides. CSV imports require an existing manual account. The entry point is in Transactions and opens booked transactions by default; balance history remains selectable in the import dialog. Accounts & assets offers bank connection and manual creation. |
| Protection | [User sessions and membership guard](../src/features/auth/server/session.ts), [library configuration](../src/features/auth/server/auth.ts), [HTTP boundary](../src/server/http/respond.ts), [bank-secret encryption](../src/server/security/secret-box.ts): Better Auth username/password, revocable database sessions, explicit singleton-workspace membership and operator enrollment, jose provider JWTs, origin checks, persistent sign-in limits and encrypted bank sessions; hosted auth migration is pending approval; no independent-customer isolation, 2FA, SSO, email recovery or financial-data E2EE |
| Deployment | [Compose](../compose.yaml), [Dockerfile](../Dockerfile), [scheduler](../scripts/scheduler.mjs), [Vercel config](../vercel.json), [deployment guide](vercel-deployment.md): Node 26 container build/runtime and Vercel production HTTP/sandbox sync accepted; daily Vercel cron is enabled and its authenticated endpoint checked; actual NAS operation and the first future unattended invocation remain open |
| Database lifecycle | [Schema](../src/server/database/schema.ts), [inferred models](../src/server/database/models.ts), [shared connection](../src/server/database/connection.ts), [migrations](../src/server/database/migrations.ts): typed Drizzle queries and remaining raw SQL share a libSQL client; versioned SQL, checksum/history checks, fresh initialization and explicit legacy adoption; existing user database not migrated |
| Behavior checks | [Finance tests](../tests/finance.test.ts), [migration tests](../tests/migrations.test.ts), [repository tests](../tests/repositories.test.ts), [session tests](../tests/session.test.ts), [dashboard lifecycle tests](../tests/dashboard-lifecycle.test.ts), [dashboard period tests](../tests/dashboard-period.test.ts) and [HTTP tests](../tests/http-errors.test.ts) cover money/imports, identity matching, environment isolation, session/JWT integrity, atomic writes/rollback, pending upgrades, logout races, current-filter refreshes, consistent period results and Problem Details/error privacy; [CI](../.github/workflows/ci.yml) runs lint, style checks, type checking, tests and build |
| Responsive checks | After the component/CSS refactor, all five views checked in Chrome emulation at 320, 360, 390, 430, 768, 844 and desktop 1440 pixels; no page overflow; forms usable at 400-pixel height |
| HTTP checks | Standalone synthetic checks cover authentication/origin checks, account/category/rule creation, repeated imports, corrections and valuations. Hosted checks additionally verify HTTPS sessions, Turso persistence, Mock ASPSP callback/account sync and a repeat sync with zero inserts. Real-bank access remains unverified |
| Not verified | Live institutions, physical phones/Safari and real bank-app redirects, large histories, first future unattended cron invocation, actual NAS operation, restore from backup, PostgreSQL, multi-tenant SaaS |

No account inventory or personal bank acceptance results are maintained in this repository. Use synthetic fixtures for examples and privately managed operational records for real deployments.

## Tracked work

Check an item only when its acceptance criterion is met and evidence is recorded. Requirements are distinct from completed implementation. The following priorities incorporate the product review.

### Existing foundation

- [x] **BASE-01** Accounts, latest net worth and cash flow for a selected month or all months, with currency isolation.
- [x] **BASE-02** End-to-end Enable Banking sandbox connection and repeat-sync deduplication check.
- [x] **BASE-03** Keyword/RE2 categorization, priorities and preserved manual category changes.
- [x] **BASE-04** Manual valuations and documented fixed-schema CSV imports.
- [x] **BASE-05** Responsive smartphone UI verified in Chrome emulation; physical device checks remain open.

### Required reliability and data workflows

- [ ] **E-01 · Live bank acceptance:** automatic bank sync is essential to the main user journey; verify consent, balances, booked transactions, repeat sync and reauthorization with supported production institutions; publish only generic compatibility results with authorization.
- [ ] **E-02 · Configurable CSV:** selectable formats and fields, preview, reusable profiles, stable reference mapping, overlap reconciliation and a visible import report. Supporting history/unsupported sources and portability is the role of CSV, not the main daily workflow. A dedicated Buxfer migration assistant is not a priority.
- [ ] **E-03 · Backup / restore:** restore database and keys on a fresh instance, verify results, then provide consistent automated backups.
- [ ] **E-04 · Provider-aware persistence:** complete provider-independent domain repositories and a verified PostgreSQL adapter with equivalent behavior. Versioned SQLite/libSQL SQL changesets and explicit legacy adoption are implemented; PostgreSQL is not supported yet.
- [ ] **E-05 · Unattended deployment:** include and verify daily sync for each supported host, visible failures/recovery, real mobile keyboards and bank-app redirects; no browser needs to stay open.

### Required product capabilities

- [ ] **K-01 · Editing, provenance and splits:** manual create/edit/delete; immutable source identity, per-import run linkage and explicit overrides; suppression of deleted imports; split allocations sum exactly to the original and are never double counted.
- [ ] **K-02 · Complete management:** edit/delete rules, delete categories (category name and color editing is implemented and covered by a behavior test), rename/archive accounts, and explicitly disconnect bank links while preserving intended history.
- [ ] **K-03 · Securities:** compatible identifiers such as ticker + venue/MIC or ISIN + listing information, quote currency, exact holdings, trades and separate settlement cash; manual prices first, later explicit market-data adapters with timestamps/licensing and predictable resync behavior.
- [ ] **K-04 · Planning:** category budgets/limits, recurring entries, reminders and forecasting; agree on the planning model before implementation.
- [ ] **K-05 · Historical wealth:** net-worth and portfolio charts from dated snapshots/valuations, clearly distinguishing missing observations, price updates and optional FX conversion.

### Everyday usability and reports

- [ ] **UX-01 · Simple onboarding:** a guided hosted bank-connect and authorization flow that reaches a useful automatically populated overview without database, provider-key, rule-language or budgeting-method setup; ordinary users must not register provider apps, enter IDs/secrets/tokens, upload keys or configure callbacks; provider selection belongs behind bank selection where feasible. File import is secondary for history/unsupported sources, and provider eligibility remains a service prerequisite.
- [ ] **UX-02 · Useful report defaults:** ready-made cash-flow, spending, category, balance, wealth-history and investment summaries with understandable labels, dates, sources, and missing-data states; a custom report builder is optional.
- [ ] **UX-03 · Optional widget editing:** add/remove, reposition and resize widgets using a mobile-OS-style edit mode; useful default layout, touch/keyboard alternatives, responsive reflow, saved layouts and reset-to-default without changing financial data.

### Before an open-source or managed release

- [ ] **OSS-01 · License and commercial eligibility:** choose the project license, review dependency/assets notices, and establish commercial banking/market-data rights. Free self-hosting plus paid managed hosting is the intended model, not an implemented offering; one synced account free with more paid is an unvalidated hosted-tier candidate, including its billing unit and provider costs.
- [ ] **OSS-02 · Publication privacy:** scan the exact Git tree and history for secrets and real financial data; exclude local environment files, keys, databases, exports, host paths and personal account inventories. Initial content is prepared with generic English examples.
- [ ] **OSS-03 · Fresh setup and demo:** verify instructions from a fresh checkout, supply synthetic demo data without bank credentials, and document supported Node/container configurations.
- [ ] **OSS-04 · Contribution and security process:** add contribution/security policies and a reporting channel; maintain automated checks and dependency review. Existing safeguards are not a completed security audit.
- [ ] **OSS-05 · Managed-hosting readiness:** tenant isolation, identity/authorization, durable scheduled jobs, operational secrets, backups/monitoring, billing and data lifecycle; verify upgrades and obtain explicit approval for a public release.

## Sources and maintenance

Primary sources checked on 2026-11-15. The [functional review](functional-review.md) records release pins, workflow implications, and the limited practical checks. Rolling docs can lead stable releases; alpha releases are not counted as stable capabilities. No pricing, institution counts, personal compatibility results, or performance benchmarks justify the conclusion.

Update status, limitation, evidence and date when a capability changes. Check a tracked item only after its acceptance criterion is met. Repository examples must remain synthetic and English.

[B1]: https://www.buxfer.com/features/
[B2]: https://www.buxfer.com/features/sync/
[B3]: https://www.buxfer.com/features/investments/
[B4]: https://buxfer.zendesk.com/hc/en-us/articles/360015881833-Can-I-split-a-single-transaction-across-multiple-tags
[B5]: https://www.buxfer.com/help/upload
[A1]: https://actualbudget.org/docs/advanced/bank-sync/
[A3]: https://actualbudget.org/docs/reports/
[A4]: https://actualbudget.org/docs/budgeting/rules/
[A5]: https://actualbudget.org/docs/transactions/importing/
[A6]: https://actualbudget.org/docs/transactions/split-transactions/
[A7]: https://actualbudget.org/docs/getting-started/envelope-budgeting/
[A8]: https://actualbudget.org/docs/schedules/
[A9]: https://actualbudget.org/docs/budgeting/multi-currency/
[A10]: https://actualbudget.org/docs/backup-restore/backup/
[A15]: https://actualbudget.org/docs/backup-restore/restore/
[A11]: https://actualbudget.org/docs/getting-started/sync/
[A12]: https://actualbudget.org/docs/api/reference/
[A13]: https://actualbudget.org/blog/release-26.11.0/
[A14]: https://actualbudget.org/docs/config/multi-user/
[F1]: https://github.com/firefly-iii/firefly-iii#features
[F2]: https://github.com/firefly-iii/data-importer
[F3]: https://github.com/orgs/firefly-iii/discussions/10190
[F4]: https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md
[F5]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/transactions.md
[F6]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/rules.md
[F7]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/budgets.md
[F8]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/reports.md
[F9]: https://github.com/firefly-iii/docs/blob/main/docs/docs/references/data-importer/duplicate-detection.md
[F10]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/data-importer/advanced/custom-import-tag.md
[F11]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/recurring.md
[F12]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/currencies.md
[F14]: https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/search.md
[F13]: https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/firefly-iii/exporting-data.md
[S1]: https://docs.sure.am/providers/enable-banking
[S2]: https://docs.sure.am/guides/app-features/transactions
[S3]: https://docs.sure.am/guides/app-features/csv-imports
[S4]: https://docs.sure.am/guides/app-features/budgets
[S5]: https://docs.sure.am/guides/key-concepts/investment-accounts
[S6]: https://docs.sure.am/providers/market-data
[S7]: https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/db/schema.rb
[S8]: https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/config/initializers/sidekiq.rb
[S9]: https://docs.sure.am/
[S10]: https://docs.sure.am/guides/key-concepts/clients
[S11]: https://docs.sure.am/features/recurring-transactions
[S12]: https://docs.sure.am/guides/app-features/family-sharing
[S13]: https://github.com/we-promise/sure/releases/tag/v0.7.6-hotfix.1
[S14]: https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/app/controllers/pages_controller.rb

User management is tracked in [issue #25](https://github.com/daberni/ufer/issues/25). The current source implements explicit operator enrollment, username/password sign-in, session/password lifecycle and active membership of one installation workspace. The [rollout](user-management.md#migration-and-rollout) is not yet applied to existing databases or the hosted installation.
