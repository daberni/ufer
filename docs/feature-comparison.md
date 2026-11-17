# Feature comparison and development status

Updated: **2026-11-17** · Working product name: **Ufer** · Version: `0.1.0`

This document tracks implemented capabilities, limitations, and accepted priorities. The [functional review](functional-review.md) explains workflows, release boundaries, source evidence, practical checks, and the build-versus-adopt conclusion. Architecture and commercial requirements are in [product-direction.md](product-direction.md). No personal account inventory is included.

## Positioning and build-versus-adopt

**Ufer currently has substantially less functionality than all four established alternatives.** Bank sync, mobile access, editable imported transactions, configurable imports, and historical wealth are already available elsewhere. Sure also covers holdings, trades, market prices, and preservation of manual corrections. This combination is not an established gap in the market.

Actual is a strong candidate for budgeting and everyday bookkeeping; Sure is the closest documented match for an integrated money-and-investments dashboard. Firefly III offers extensive bookkeeping and automation, without a dedicated securities engine. Buxfer remains a broad hosted reference. These are fit assessments, not completed acceptance tests. Ufer targets everyday users through automatic bank synchronization, a consolidated view across institutions, simple hosted onboarding, useful report defaults and optional dashboard customization. File imports/exports support history, unsupported sources and portability; they are not the primary everyday workflow. Basic tagging and budgets alone are not the proposed reason to subscribe. That is a usability direction to validate, rather than a claim that existing financial functionality is missing.

| Product / reviewed release | Focus | Deployment / license |
| --- | --- | --- |
| Ufer `0.1.0` | Aggregation, cash flow, rules, manual valuations; early MVP | Docker/NAS configuration; verified Vercel sandbox deployment on Node 26; SQLite/libSQL; AGPL-3.0-or-later |
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
| Bank balances and transactions | **Yes:** Enable Banking; booked only; the raw provider transaction is stored with every booking up to 64 KiB of JSON (larger records keep only their parsed fields), and the original amount and currency of a foreign-currency payment as their own fields when the bank sends them, covered by behavior tests with synthetic payloads | **Yes** [B2] | **Yes:** several providers; Enable Banking experimental [A1] | **Yes:** companion importer [F2] | **Yes:** Enable Banking and others [S1] |
| Connect, reauthorize and remove | **Yes:** sandbox connect/reauthorize verified; removal keeps account history and is covered by synthetic tests; live banks open | **Yes** [B2] | **Yes:** provider setup [A1] | **Yes:** importer setup [F4] | **Yes:** session/reconnect workflow [S1] |
| Bank linking without user-supplied provider credentials | **Partial:** operator environment setup; sandbox consent flow, no managed service | **Yes:** hosted linking [B2] | **Partial:** provider setup before consent [A1] | **Partial:** importer/provider configuration [F4] | **Partial:** reviewed self-hosted UI asks for application credentials before consent [S1] |
| Sync with browsers closed | **Yes:** scheduler configured; target hosting not accepted | **Yes:** provider-dependent [B2] | **Yes via external API job:** built-in interval requires open app [A12] | **Yes via importer CLI/API + scheduler** [F2] | **Yes:** worker scheduler in stable source [S8] |
| Balances, income and spending | **Yes:** separate currency totals; hovering, focusing or tapping an income or expense bar in the six-month chart splits that bar by category and shows its breakdown (only transactions of type income and expense count, so transfers, opening balances and adjustments are excluded whatever their category; a refund typed as an expense reduces spending; uncategorized transactions as their own row) overlaid on the chart above 1250 px and in a fixed area below the bars otherwise; agreement with each month's totals and spending breakdown is covered by behavior tests, and the interaction was checked in Chrome with synthetic data (mouse, keyboard, 375 px touch emulation, a 360–1600 px width sweep) Each account has a details view at `/accounts/<id>` with its current balance, balance history (chart and table), income, spending and categorized transfers for the selected period and its transactions; the per-account flows and history are covered by behavior tests and the view was checked in Chrome with synthetic manual and synced accounts at 375 px and desktop width in light and dark | **Yes** [B1] | **Yes:** reports [A3] | **Yes:** reports [F8] | **Yes:** wealth/cash-flow views [S9] |
| Transfers between own accounts | **Yes:** a transfer is a transaction type, independent of its category. Two bookings of one transfer are linked, shown with each other's account and corrected together; a transfer to an untracked account needs no counterpart; marking a booking as a transfer to a manual account creates the counterpart there. Sync, CSV import and the demo seed pair bookings automatically (opposite amounts, same currency, two own accounts, at most 3 days apart, only with exactly one candidate). The demo seed shows all three cases. Behavior tests cover pairing, ambiguity, currency and window limits, corrections across resync and the edit dialog's targets. Manual account balances are not yet derived from these bookings ([#138](https://github.com/daberni/ufer/issues/138)) | **Unverified:** not assessed | **Unverified:** not assessed | **Unverified:** not assessed | **Unverified:** not assessed |
| Search and filters | **Yes:** text, ignoring letter case including umlauts and ß/ss but not accents, account, category; month or all months shared with the overview; paginated; kept in the URL, so Back/Forward, reload and links restore them; only the areas a filter affects show loading placeholders, and a failed load offers Retry | **Yes** [B1] | **Yes:** transaction filters [A5] | **Yes:** transaction search [F14] | **Yes:** transaction filters [S2] |
| Categorization and rule management | **Partial:** rules create/toggle/apply; category create/edit (name, color, optional icon from a curated set); no rule edit/delete or category delete | **Yes** [B1] | **Yes:** editable rules and payee learning [A4] | **Yes:** grouped rules and multiple actions [F6] | **Yes:** conditions, order, stop-processing [S2] |
| Manual entries and full field editing | **Partial:** category and type only. The category is chosen from a searchable select that also creates a category missing from the list; a change shows immediately per row, saves in order per transaction and reverts with an inline error on failure. The type (income, expense, transfer; opening balance and adjustment on manual accounts) and a transfer's target are edited in one dialog per row with a single Save: a suggested booking on another account, a manual account on which the counterpart is created, or none; corrections survive resync and imports (behavior tests; checked in Chrome with synthetic data at 375 px and desktop). No manual entry of new transactions ([#138](https://github.com/daberni/ufer/issues/138)) | **Yes** [B1] | **Yes:** register/API [A12] | **Yes:** create/edit/delete [F5] | **Yes:** single/bulk editing [S2] |
| Split transactions | **No:** required | **Yes:** allocated tags [B4] | **Yes:** parent/children [A6] | **Yes:** split journals [F5] | **Yes:** split groups [S2] |
| Configurable CSV imports | **Partial:** one fixed schema | **Partial evidence:** CSV/Excel yes; mapping profiles unverified [B5] | **Yes:** field/date/delimiter options [A5] | **Yes:** importer mapping/configuration [F2] | **Yes:** mapping, preview, reusable setup [S3] |
| Reimport reconciliation / deduplication | **Partial:** account references; cross-source matching absent | **Yes:** matching workflow [B2] | **Yes:** IDs and fallback matching [A5] | **Yes:** import hashes/external IDs [F9] | **Partial:** provider identities; CSV/feed overlap not guaranteed [S1], [S3], [S7] |
| Provenance and manual edits across resync | **Partial:** source reference; sync history links each run to the transactions it inserted (runs before this link are not traceable); no CSV batch trail or field overrides | **Partial evidence:** sync source/matching; full field history unverified [B2] | **Partial evidence:** imported identity/matching; full source-versus-override audit unverified [A5] | **Partial:** import tags/hash; field-level protection unverified [F9], [F10] | **Yes:** source IDs and manual field locks; full audit requirement not accepted [S2], [S7] |
| Light and dark theme | **Yes:** follows the operating system by default; System/Light/Dark choice in account settings, remembered per browser and applied by the server before the first paint; checked in Chrome with synthetic data (color-scheme emulation, manual choice, reload, sign-in, 375 px) | **Unverified:** not assessed | **Unverified:** not assessed | **Unverified:** not assessed | **Unverified:** not assessed |
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
| Historical net worth | **Yes:** monthly net worth per currency on the overview (chart with cash, investments, property and loans lines, plus a data table) from recorded balances; balances recorded in an earlier month are carried forward and marked, not interpolated; no FX conversion; carry-forward, gaps, period windows and currency isolation are covered by behavior tests and the view was checked in Chrome with synthetic data at 375 px and desktop width in light and dark | **Yes:** documented/existing capability [B1] | **Yes:** net-worth reports [A3] | **Partial evidence:** balance-history reports; exact net-worth chart unverified [F8] | **Yes:** wealth history [S9] |
| Manual assets and liabilities | **Yes:** dated balances, including an optional past date for the starting balance | **Yes** [B2] | **Yes:** off-budget accounts [A3] | **Yes:** asset/liability bookkeeping [F1] | **Yes:** asset/debt accounts [S9] |
| Native multi-currency and FX | **Partial:** separate totals; no conversion; the transaction list shows the original amount and currency of a foreign-currency bank booking when the bank provides it | **Yes** [B1] | **No:** native model unsupported; experimental workaround [A9] | **Yes:** currencies; rate setup not tested [F12] | **Yes:** currencies and market-data FX [S6] |
| Tags and category hierarchy | **No:** one flat category | **Yes** [B1] | **Yes:** category groups and tags [A12] | **Partial:** categories/tags; nesting not established [F1] | **Yes:** categories/subcategories and tags [S2], [S4] |
| Sharing and permissions | **Partial:** individual users in one shared workspace; operator enrollment and active membership checks; no separate customer workspaces or fine-grained permissions; hosted cutover pending | **Yes:** access control/IOUs [B1] | **Yes:** OIDC, Basic/Admin and budget access [A14] | **Unverified:** exact collaboration/access model | **Yes:** account-level sharing permissions [S12] |
| Local-first / financial-data E2EE | **No:** bank-session encryption only | **Unverified:** no equivalent established | **Yes:** local-first; optional budget E2EE excludes bank tokens [A11] | **Unverified:** no equivalent established | **Unverified:** no equivalent established |
| Export and restore | **No UI:** manual database/key backup | **Yes:** API/backups [B1] | **Yes:** budget export and restore workflow [A10], [A15] | **Partial:** CSV/API exports; full restore requires database backup [F13] | **Yes:** data export; stable release includes instance backup/restore [S3], [S13] |

**Ufer management gaps:** rule editing/deletion, category deletion, account rename/archive and deletion of accounts from removed bank connections remain open. Removing a bank connection is implemented; it retains the detached accounts and their history. Editing source-derived data is a product requirement; the current restriction is MVP scope. Planned work does not count as a capability.

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
| UI | [Dashboard composition](../src/features/dashboard/dashboard.tsx), [view routes](../src/app/%28dashboard%29/layout.tsx) with [URL state](../src/client/app-location.ts) for browser history and deep links, [server state](adr/decisions/006-client-server-state.md) through per-area TanStack queries and per-action mutations, [component styles](../src/features/dashboard/dashboard.module.css), [global base](../src/app/globals.css), [viewport](../src/app/layout.tsx): responsive cards and forms; desktop table retained; [Ufer identity](branding/README.md) integrated into sidebar, login, footer and Next.js browser/touch metadata |
| Domain data | [HTTP boundary](../src/server/http/respond.ts), [changesets](../drizzle/sqlite/0000_initial_schema.sql), [storage](../src/features/transactions/server/transaction-repository.ts), [amounts](../src/lib/money.ts): integer minor units, account-scoped references and manual category preservation; [Problem Details](http-errors.md) with correlated trace IDs, user validation (422) and rejected provider data (502) |
| Banking | [Provider client](../src/features/banking/server/enable-banking-client.ts), [sync service](../src/features/banking/server/sync-service.ts), [sync repository](../src/features/banking/server/sync-repository.ts), [callback](../src/app/api/banking/callback/route.ts), [connection removal](../src/features/banking/server/connection-service.ts): sandbox authorization completed, booked transactions persisted and repeat sync checked without additional duplicates; services no longer execute SQL. The original amount is validated at the [bank-data boundary](../src/features/banking/server/provider-details.ts) and dropped without stopping the import when malformed; each sync refreshes it and the raw transaction, from which later features can derive further fields; verified with synthetic payloads, not yet against a sandbox or production bank. Connection removal detaches accounts, deletes the stored session and requests best-effort provider revocation; verified with synthetic tests and a mocked provider, not against the Enable Banking sandbox |
| Imports / rules | [CSV](../src/lib/import.ts), [rules](../src/lib/rules.ts): fixed schemas; 1 MB/10,000-row limits; RE2/keyword matching; no field-mapping UI or full transaction overrides. CSV imports require an existing manual account. The entry point is in Transactions and opens booked transactions by default; balance history remains selectable in the import dialog. Accounts & assets offers bank connection and manual creation. |
| Protection | [User sessions and membership guard](../src/features/auth/server/session.ts), [library configuration](../src/features/auth/server/auth.ts), [HTTP boundary](../src/server/http/respond.ts), [bank-secret encryption](../src/server/security/secret-box.ts): Better Auth username/password, revocable database sessions ending after 24 hours without use, server-enforced revocation of other sessions on password change, explicit singleton-workspace membership and operator enrollment, jose provider JWTs, origin checks, a fixed same-origin [Content-Security-Policy](security.md#browser-security-headers) with Permissions-Policy and HSTS headers, JSON API bodies capped at 2 MiB while they are read, persistent sign-in limits and encrypted bank sessions; hosted auth migration is pending approval; no independent-customer isolation, 2FA, SSO, email recovery or financial-data E2EE |
| Deployment | [Compose](../compose.yaml), [Dockerfile](../Dockerfile), [scheduler](../scripts/scheduler.mjs), [Vercel config](../vercel.json), [deployment guide](vercel-deployment.md): production servers refuse to start without an HTTPS `APP_URL` (Docker therefore runs behind an HTTPS reverse proxy; covered by behavior tests and a local `next start`, not yet verified on the hosted deployment); Node 26 container build/runtime and Vercel production HTTP/sandbox sync accepted; daily Vercel cron is enabled and its authenticated endpoint checked; actual NAS operation and the first future unattended invocation remain open |
| Database lifecycle | [Schema](../src/server/database/schema.ts), [inferred models](../src/server/database/models.ts), [shared connection](../src/server/database/connection.ts), [migrations](../src/server/database/migrations.ts): typed Drizzle queries and remaining raw SQL share a libSQL client; versioned SQL, checksum/history checks, fresh initialization and explicit legacy adoption; existing user database not migrated |
| Behavior checks | [Finance tests](../tests/finance.test.ts), [migration tests](../tests/migrations.test.ts), [repository tests](../tests/repositories.test.ts), [session tests](../tests/session.test.ts), [dashboard lifecycle tests](../tests/dashboard-lifecycle.test.ts), [categorization tests](../tests/transaction-categorization.test.ts), [independent action tests](../tests/independent-actions.test.ts), [dashboard period tests](../tests/dashboard-period.test.ts), [connection removal tests](../tests/connection-removal.test.ts), [transaction type tests](../tests/transaction-types.test.ts) and [HTTP tests](../tests/http-errors.test.ts) cover money/imports, identity matching, environment isolation, session/JWT integrity, atomic writes/rollback, pending upgrades, logout races, current-filter refreshes, per-area loading and failure states, serialized per-row categorization, transaction types and transfer pairing, independent action states, consistent period results and Problem Details/error privacy; [CI](../.github/workflows/ci.yml) runs lint, style checks, type checking, tests and build |
| Legal pages | [Privacy notice](../src/features/legal/components/privacy-notice.tsx), [terms of use](../src/features/legal/components/terms-of-use.tsx), [deployment configuration](../src/features/legal/server/legal-configuration.ts): public `/privacy` and `/terms` pages without sign-in, linked from sign-in and the dashboard footer; operator identity/contact and hosting/database providers come from validated environment variables, and unconfigured installations say so. The texts have not been legally reviewed; operator details and data processors are configured on the hosted deployment |
| Responsive checks | After the component/CSS refactor, all five views checked in Chrome emulation at 320, 360, 390, 430, 768, 844 and desktop 1440 pixels; no page overflow; forms usable at 400-pixel height |
| Themes | [Color tokens](../src/app/globals.css) define both palettes; [theme preference](../src/features/appearance/theme-preference.ts) and the [root layout](../src/app/layout.tsx) render the chosen theme from a cookie; [category colors](../src/features/categorization/category-colors.ts) derive tints and readable text per theme without changing stored colors (behavior tests). An automated contrast pass over all five views, the CSV dialog and the category popover found no text below 4.5:1 in either theme; text on gradients and disabled controls was not measured. Physical devices and Safari/Firefox not checked |
| HTTP checks | Standalone synthetic checks cover authentication/origin checks, account/category/rule creation, repeated imports, corrections and valuations. Hosted checks additionally verify HTTPS sessions, Turso persistence, Mock ASPSP callback/account sync and a repeat sync with zero inserts. Production banking: authorization and a first sync with two production institutions (2026-11-16); repeat sync and reauthorization remain unverified |
| Not verified | Repeat sync and reauthorization with production institutions, physical phones/Safari and real bank-app redirects, large histories, first future unattended cron invocation, actual NAS operation, restore from backup, PostgreSQL, multi-tenant SaaS |

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

- [ ] **E-01 · Live bank acceptance:** automatic bank sync is essential to the main user journey; verify consent, balances, booked transactions, repeat sync and reauthorization with supported production institutions; publish only generic compatibility results with authorization. Since 2026-11-16 the hosted deployment uses a production Enable Banking application in restricted mode (the operator's own linked accounts): two production institutions are connected and their first sync imported booked transactions and balances; the privacy-notice and terms pages are configured. Repeat sync, reauthorization and the unattended daily sync remain open, as does the security prerequisite [#69](https://github.com/daberni/ufer/issues/69) (provider data validation and session revocation). Per-client authentication rate limits ([#68](https://github.com/daberni/ufer/issues/68)) are implemented and covered by behavior tests; their behavior on the hosted deployment is not yet verified. Storing raw provider transactions and original amounts ([#91](https://github.com/daberni/ufer/issues/91)) is implemented and covered by behavior tests with synthetic payloads; it has not run against a production institution, and the hosted database needs changeset 0003 before that version is deployed.
- [ ] **E-02 · Configurable CSV:** selectable formats and fields, preview, reusable profiles, stable reference mapping, overlap reconciliation and a visible import report. Supporting history/unsupported sources and portability is the role of CSV, not the main daily workflow. A dedicated Buxfer migration assistant is not a priority.
- [ ] **E-03 · Backup / restore:** restore database and keys on a fresh instance, verify results, then provide consistent automated backups. Mainly an infrastructure task; tracked in [#84](https://github.com/daberni/ufer/issues/84).
- [ ] **E-04 · Provider-aware persistence:** complete provider-independent domain repositories and a verified PostgreSQL adapter with equivalent behavior. Versioned SQLite/libSQL SQL changesets and explicit legacy adoption are implemented; PostgreSQL is not supported yet.
- [ ] **E-05 · Unattended deployment:** include and verify daily sync for each supported host, visible failures/recovery, real mobile keyboards and bank-app redirects; no browser needs to stay open.

### Required product capabilities

- [ ] **K-01 · Editing, provenance and splits:** manual create/edit/delete; immutable source identity, per-import run linkage and explicit overrides; suppression of deleted imports; split allocations sum exactly to the original and are never double counted. (Sync runs are linked to the transactions they inserted, and the history opens them as a filtered list, covered by behavior tests; CSV import runs are not linked yet.) Manual editing, suppression and splits are tracked in [#85](https://github.com/daberni/ufer/issues/85); transaction types separate from categories and linked transfers are implemented ([#38](https://github.com/daberni/ufer/issues/38)); manual transactions on manual accounts follow in [#138](https://github.com/daberni/ufer/issues/138).
- [ ] **K-02 · Complete management:** edit/delete rules, delete categories (category name, color and optional icon editing is implemented and covered by behavior tests; a shared square color tile, tinted with the optional icon, marks categories in rules, transactions, the spending breakdown and the category form preview), rename/archive accounts, and explicitly disconnect bank links while preserving intended history. Tracked in [#83](https://github.com/daberni/ufer/issues/83) (rename accounts), [#86](https://github.com/daberni/ufer/issues/86) (rules, categories, archiving, disconnecting), [#65](https://github.com/daberni/ufer/issues/65) (bank connections within accounts) and [#79](https://github.com/daberni/ufer/issues/79) (rules from the category picker).
- [ ] **K-03 · Securities:** compatible identifiers such as ticker + venue/MIC or ISIN + listing information, quote currency, exact holdings, trades and separate settlement cash; manual prices first, later explicit market-data adapters with timestamps/licensing and predictable resync behavior.
- [ ] **K-04 · Planning:** category budgets/limits, recurring entries, reminders and forecasting; agree on the planning model before implementation.
- [ ] **K-05 · Historical wealth:** net-worth and portfolio charts from dated snapshots/valuations and current balances, clearly distinguishing missing observations, price updates and optional FX conversion. Each account's balance history is shown in its details view and monthly net worth per currency on the overview ([#87](https://github.com/daberni/ufer/issues/87)); portfolio charts, price updates and FX conversion remain open.

### Everyday usability and reports

- [ ] **UX-01 · Simple onboarding:** a guided hosted bank-connect and authorization flow that reaches a useful automatically populated overview without database, provider-key, rule-language or budgeting-method setup; ordinary users must not register provider apps, enter IDs/secrets/tokens, upload keys or configure callbacks; provider selection belongs behind bank selection where feasible. File import is secondary for history/unsupported sources, and provider eligibility remains a service prerequisite.
- [ ] **UX-02 · Useful report defaults:** ready-made cash-flow, spending, category, balance, wealth-history and investment summaries with understandable labels, dates, sources, and missing-data states; a custom report builder is optional. Per-month category breakdowns of income and expenses in the cash-flow chart are implemented; monthly net-worth history with its composition is implemented; category trends across months beyond the six-month window and investment summaries remain open.
- [ ] **UX-03 · Optional widget editing:** add/remove, reposition and resize widgets using a mobile-OS-style edit mode; useful default layout, touch/keyboard alternatives, responsive reflow, saved layouts and reset-to-default without changing financial data.
- [ ] **UX-04 · Responsive loading:** views appear quickly on a cold start and with a remote database: the session is resolved on the server, the app frame renders at once, each area loads independently with skeletons, and requests avoid avoidable round trips. Measurements and fixes are tracked in [#82](https://github.com/daberni/ufer/issues/82) and [#74](https://github.com/daberni/ufer/issues/74).
- [ ] **UX-05 · Localization:** the interface is available in the supported languages with matching date, number and currency formats; code and documentation stay in English. Tracked in [#21](https://github.com/daberni/ufer/issues/21).
- [x] **UX-06 · Dark mode:** light and dark palettes through semantic tokens, operating-system default with a per-browser System/Light/Dark choice, no light flash on load or after sign-in. Tracked in [#94](https://github.com/daberni/ufer/issues/94).

### Before an open-source or managed release

- [x] **OSS-01a · License and notices:** the project is licensed under AGPL-3.0-or-later ([LICENSE](../LICENSE), README, `package.json`); contributions require the [contributor license agreement](../CLA.md), accepted through CLA Assistant (to be connected before the first outside contribution is merged); the sign-in screen and dashboard footer name the license and link the source code; third-party artwork is listed in the [branding notes](branding/README.md#third-party-artwork). The license grants no trademark rights to the Ufer name or icon.
  - [ ] **Third-party notices:** generate notices for the production dependency tree (including the LGPL libvips binaries bundled with sharp) from the lockfile. Required before publishing a prebuilt image or running the managed service; not needed for users who build from source.
- [ ] **OSS-01b · Commercial provider eligibility:** an Enable Banking commercial agreement (KYB, AISP or partner setup, pricing and minimum invoice) is required before any hosted offering, including a free hosted tier; market-data redistribution and commercial-use rights must be checked once a provider is selected. Free self-hosting plus paid managed hosting is the intended model, not an implemented offering; one synced account free with more paid is an unvalidated hosted-tier candidate, including its billing unit and provider costs.
- [ ] **OSS-02 · Publication privacy:** scan the exact Git tree and history for secrets and real financial data; exclude local environment files, keys, databases, exports, host paths and personal account inventories. Initial content is prepared with generic English examples.
- [ ] **OSS-03 · Fresh setup and demo:** verify instructions from a fresh checkout, supply synthetic demo data without bank credentials, and document supported Node/container configurations. `npm run demo:seed` now writes an 18-month synthetic dataset without bank credentials ([setup](setup.md#demo-data)); verification from a fresh checkout and the container configurations remain open.
- [ ] **OSS-04 · Contribution and security process:** [contribution guidelines](../CONTRIBUTING.md) and the CLA exist; connect CLA Assistant before the first outside contribution is merged; maintain automated checks and dependency review. The [security policy](../SECURITY.md) directs reports to GitHub's private vulnerability reporting. A white-box security assessment on 2026-11-16 found no critical or high issue; its findings are tracked in [#68](https://github.com/daberni/ufer/issues/68) to [#73](https://github.com/daberni/ufer/issues/73), and [#72](https://github.com/daberni/ufer/issues/72) covers CI pinning and dependency review.
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


Account balance history: cash accounts with booked transactions show daily estimates between recorded observations, preserving the original values and source on every recorded date. Calculated points are identified in the table. Days without bookings carry the preceding closing balance. Explicit opening-balance transactions can anchor manual accounts at zero before their first booking; partial imports without any balance reference do not imply zero. Accounts without transactions and market-valued assets retain their recorded valuation history unless an explicit opening/adjustment ledger defines their values. Stale synced histories stop at the latest known sync, observation or booking date. The chart uses horizontal steps and vertical changes, and was checked with synthetic data at desktop and 375 px width.

Transaction list update: the existing type icon identifies income, expenses, transfers, opening balances and adjustments without a separate Type column. A row-wide edit button supports pointer and keyboard use while category and description controls remain independent. Transfers show the counterpart account below their account name. The seeded Transfer category is retired by a separate, unapplied data migration; custom categories remain supported.
