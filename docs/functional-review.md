# Functional review: Ufer and existing personal-finance tools

Reviewed: **2026-11-15**. This is a workflow and evidence review, not a completed migration trial or a comparative performance benchmark. See the [feature matrix](feature-comparison.md) for tracked implementation status and [product direction](product-direction.md) for accepted requirements.

## Assessment

**Actual already provides a substantial budgeting and bookkeeping core. Sure is the closest documented fit for an integrated wealth-and-transactions application. Ufer is currently an early aggregation MVP.** Firefly III and Buxfer also cover many workflows that Ufer still lacks. The earlier comparison understated alternatives by leaving splits, editing, imports and Sure's investment workflows insufficiently assessed.

The meaningful product question is whether existing tools can deliver an approachable daily experience, including automatic bank synchronization, a consolidated view across institutions, mobile use and onboarding. Basic bank-app tagging and budgeting are not sufficient proposed paid value; manual CSV must remain a supporting path rather than the main product experience. A preferred appearance is a valid requirement, but it is not evidence of a missing financial engine. The subsequent product decision is to continue Ufer independently in Node/React; see [ADR 001](adr/decisions/001-continue-ufer.md). This review remains the functional evidence, not a claim that Ufer has reached competitor parity.

## Review boundaries

| Product | Reviewed baseline | Evidence |
| --- | --- | --- |
| [Actual](https://github.com/actualbudget/actual/releases/tag/v26.11.0) | 26.11.0; release article dated November 1 | Official documentation/release; local Docker launch and synthetic demo inspection |
| [Sure](https://github.com/we-promise/sure/releases/tag/v0.7.6-hotfix.1) | 0.7.6-hotfix.1, published November 12 | Official draft documentation; pinned schema, models, worker initializer and compose file; no successful local app session |
| [Firefly III](https://github.com/firefly-iii/firefly-iii/releases/tag/v6.7.9) | 6.7.9; [Data Importer 2.3.5](https://github.com/firefly-iii/data-importer/releases/tag/v2.3.5) | Official repository, documentation source and maintainer statement; not installed in this review |
| [Buxfer](https://www.buxfer.com/features/) | Hosted service; no public application version pin | Official feature/help pages; no fresh private-account or bank test |
| Ufer | Local `0.1.0` implementation | Existing code and previously recorded synthetic/sandbox checks; no new live-bank test |

A documented feature is not an observed successful workflow. Sure's rolling docs are marked draft and include preview features and version-specific notes. They can describe behavior beyond the pinned stable release. Alpha-only features are not promoted to stable claims. Financial correctness, restoration, physical-phone behavior and institution compatibility still require acceptance tests.

## Everyday bookkeeping and imports

| Scenario | Functional comparison and consequence |
| --- | --- |
| Enter and correct a transaction | Actual, Firefly III, Sure and Buxfer document transaction management. Ufer permits category correction only. Creating entries and changing dates, payees, amounts or deleting them remain genuine Ufer gaps. |
| Divide one purchase between categories | All four alternatives support splits. Buxfer allocates tags; Actual has parent/child transactions; Firefly splits journals with account constraints; Sure documents split groups. Ufer has none. This is not a differentiator to invent. |
| Categorize repeat merchants automatically | Alternatives have editable rules; Actual also learns payee rules. Firefly supports grouped conditions and varied actions. Sure documents ordering and stop-processing. Ufer's keyword/RE2 engine is narrower and lacks rule edit/delete. |
| Import historical bank files | Actual maps CSV columns and accepts other financial formats. Firefly uses its separate configurable importer. Sure documents staged import/mapping and reusable setup. Buxfer supports CSV/Excel and standard financial formats; reusable arbitrary mapping profiles were not established. Ufer requires its fixed canonical CSV. |
| Correct imported data, then sync again | Sure documents field locks and its stable schema stores source/external IDs and locks. Actual documents identity matching; Firefly's import hash persists through edits and supports import tags. These mechanisms are different from a complete original-versus-override audit. Ufer has category protection but lacks per-field overrides/import-run history. |

Sources: [Actual imports](https://actualbudget.org/docs/transactions/importing/), [rules](https://actualbudget.org/docs/budgeting/rules/) and [splits](https://actualbudget.org/docs/transactions/split-transactions/); [Firefly transactions](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/transactions.md), [rules](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/rules.md), [duplicate detection](https://github.com/firefly-iii/docs/blob/main/docs/docs/references/data-importer/duplicate-detection.md) and [import tags](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/data-importer/advanced/custom-import-tag.md); [Sure transactions](https://docs.sure.am/guides/app-features/transactions) and [imports](https://docs.sure.am/guides/app-features/csv-imports); [Buxfer splits](https://buxfer.zendesk.com/hc/en-us/articles/360015881833-Can-I-split-a-single-transaction-across-multiple-tags) and [uploads](https://www.buxfer.com/help/upload).

**Important Sure import limitation:** its current guide says the general transaction-import account selector lists manual accounts. It does not promise that existing linked accounts appear. It also explicitly warns against assuming CSV imports deduplicate against provider imports. That makes overlapping historical CSV plus ongoing bank feed a required fit test, not an already solved workflow. Do not create duplicate accounts or disconnect working feeds to bypass the selector.

Firefly's splits have explicit constraints: a withdrawal has one source asset account, a deposit one destination asset account, and transfer splits share their source/destination. This is detailed bookkeeping, not missing split support.

## Budgets, reporting, and planning

Actual is the strongest fit when budgeting is central: envelope and tracking modes, schedules, category groups, tags, configurable report dashboards, cash flow, spending analysis and historical net worth. Off-budget balances can contribute to wealth without becoming spending money. Its balance forecast and Monte Carlo analysis are experimental; investment phases in the November release belong to simulations, not a securities register. [Reports](https://actualbudget.org/docs/reports/), [budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting/), [schedules](https://actualbudget.org/docs/schedules/), [26.11.0 release](https://actualbudget.org/blog/release-26.11.0/).

Firefly separates period budgets, categories and tags and supports recurring entries and savings goals. Auto-budgets can reset or accumulate, including an overspending adjustment variant; cron must run. Sure documents category limits, subcategories and rollover of positive surplus: overspending does not reduce the next envelope. Personal budgets are labeled preview. These products do not have interchangeable budgeting semantics. [Firefly budgets](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/budgets.md), [recurring entries](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/recurring.md), [Sure budgets](https://docs.sure.am/guides/app-features/budgets).

Buxfer documents budgets, reminders and forecasts. Sure documents recurring transactions and goals, but this review does not establish an equivalent to every Buxfer forecasting or Actual simulation workflow. Ufer currently shows historical summaries; it has no budget, schedule or forecast engine. [Buxfer features](https://www.buxfer.com/features/), [Sure recurring transactions](https://docs.sure.am/features/recurring-transactions).

### Implications for Ufer's audience and report UI

Ufer targets everyday users. A useful default overview and reports should work before any customization: available money, income/spending, category trends, wealth history, and investments where data permits. Advanced reporting is optional. Hosted onboarding should lead with bank connection and automatic data retrieval, keeping file import secondary, without requiring the user to configure infrastructure or obtain provider keys; commercial provider access is a prerequisite for delivering that experience.

The accepted interaction direction is a mobile-OS-style widget edit mode: add/remove, reposition and choose sizes, with responsive reflow and accessible alternatives to dragging. Keep useful defaults and a reset action. This is a planned Ufer requirement, not an existing feature. Actual establishes the value of configurable report collections; this review did not separately verify every drag/resize interaction in Actual.

Sure's stable source also implements configurable dashboard cards: stored section order, show/hide actions, and width/height presets. The Stimulus controllers repack cards in a responsive masonry grid and save size preferences; this is not evidence of an arbitrary report-builder widget catalog. This source inspection improves on the earlier unverified widget-editor assessment, but no dashboard interaction was executed in a running Sure instance. [Dashboard controller](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/app/controllers/pages_controller.rb), [widget sizing](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/app/javascript/controllers/dashboard_widget_size_controller.js), [masonry layout](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/app/javascript/controllers/dashboard_masonry_controller.js).

Actual also offers a theme catalog and CSS overrides. Those can improve appearance without replacing bookkeeping, but a color theme does not automatically redesign navigation or simplify the mental model. Its Node API is a possible integration boundary for custom reporting or automation; a complete new frontend is a separate engineering decision. [Themes](https://actualbudget.org/docs/custom-themes/), [API reference](https://actualbudget.org/docs/api/reference/).

## Securities, identifiers, and currencies

| Product | What investment support actually means here |
| --- | --- |
| Ufer | Dated manual/CSV account valuations only; no instrument ledger, quantities, trades, prices or performance calculations |
| Actual | Off-budget balances included in net worth; no equivalent native securities ledger established by reviewed sources; retirement simulations do not fill that gap |
| [Firefly III](https://github.com/orgs/firefly-iii/discussions/10190) | Generic asset-account bookkeeping; maintainer explicitly distinguishes this from unsupported dedicated investment tracking |
| [Sure](https://docs.sure.am/guides/key-concepts/investment-accounts) | Holdings, trades, cost basis and quote-driven valuation; the closest documented match for a combined application; calculations and broker imports not practically accepted here |
| [Buxfer](https://www.buxfer.com/features/investments/) | Advertised holdings, prices, allocation and gains; advertised functionality does not establish reliable results for an individual broker |

Sure's pinned [security model](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/app/models/security.rb) validates ticker plus operating MIC; its [schema](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/db/schema.rb) has venue, prices, trades and holdings structures, without a dedicated ISIN column in the securities table. **Ticker + MIC is acceptable for Ufer's requirement.** Support compatible identifier combinations and explicit listings/currencies; neither ISIN nor an unqualified ticker identifies every quotation. A missing standalone ISIN field is not an adoption blocker.

Sure documents Yahoo-based quotes and alternative market-data/FX providers. Verify a synthetic instrument's listing, quote currency, price timestamp, fees, trade cash and valuation before trusting a portfolio result. Separate instrument identification, broker import, price availability and performance calculation: success in one does not validate the others. [Market data](https://docs.sure.am/providers/market-data).

Actual explicitly lacks native multi-currency accounting; its documented workaround is experimental. A display currency selector is not an FX ledger. Sure, Firefly and Buxfer document currency features; Ufer deliberately keeps currency totals separate without FX conversion. [Actual limitation](https://actualbudget.org/docs/budgeting/multi-currency/), [Firefly currencies](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/currencies.md).

For a specialist alternative, [Portfolio Performance](https://www.portfolio-performance.info/en/) documents trades, fees/taxes, historical quotes, allocation, TWR/IRR and exports. Its [PDF imports](https://help.portfolio-performance.info/en/reference/file/import/pdf-import/) use specific broker/document parsers, not universal PDF understanding. Pairing a specialist with a budgeting app is an option if investment accuracy outweighs the convenience of one application; this desktop-centered tool was not installed or assessed as a full web banking replacement.

## Banking, deployment, mobile, and data control

**Sure has bank sync:** its Enable Banking integration documents bank authorization, balance/transaction retrieval and periodic refresh. The CSV limitation above concerns combining additional file history with bank-feed data, not the absence of a bank connection.

Bank sync is already present in every main alternative. Actual supports several regional providers, with Enable Banking experimental. Firefly requires its companion importer. Sure documents Enable Banking and has worker scheduling in its pinned source. Buxfer documents Yodlee/Salt Edge. Real institution consent and data quality remain untested here. [Actual providers](https://actualbudget.org/docs/advanced/bank-sync/), [Firefly importer](https://github.com/firefly-iii/data-importer), [Sure Enable Banking](https://docs.sure.am/providers/enable-banking), [Buxfer sync](https://www.buxfer.com/features/sync/).

Actual's built-in automatic interval runs only while the app is open; an external scheduled Node API process can run bank sync without a browser. Sure registers automatic-account and market-data schedulers in its stable [worker initializer](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/config/initializers/sidekiq.rb). Firefly importer automation also needs a scheduled trigger. None should be marked as fundamentally incapable of unattended sync merely because setup is required.

**Connection presence and connection simplicity are separate criteria.** Sure's reviewed self-hosted bank-sync UI exposes provider choices and an Enable Banking application ID/client-certificate setup. Its documentation confirms configuration precedes bank consent. This is not the intended Ufer hosted experience: ordinary users select a bank and authorize access while the operator manages provider credentials. The saved UI evidence does not establish that every Sure deployment must expose identical setup or that Sure lacks authorization flows.

Ufer's current backend already separates server-configured application credentials from sandbox user consent. Production managed onboarding remains unimplemented. For any alternative, assess operator setup separately from the steps a normal finance user must complete. Integrations offering only manually generated personal tokens do not become OAuth-capable merely through a redesigned form.

Sure's draft bank guide lists decoupled/separate-device authentication as unsupported. The guide also contains dated version notes, so the actual consent flow needs direct validation rather than a blanket statement about all Austrian banks. This review does not use private institutions or financial data as public compatibility evidence.

| Concern | Decision-relevant difference |
| --- | --- |
| Hosting | Actual uses a persistent Node server; Firefly uses PHP/database plus importer/cron; Sure's standard compose uses web/worker/PostgreSQL/Redis. Ufer's NAS/Vercel configuration is a deployment preference, not a feature-parity advantage or proven resource win. |
| Phone use | Actual documents mobile web, Buxfer mobile access and Sure web/native clients. Sure's mobile companion is not assumed to match its full web UI. No competitor was accepted on a physical phone, including bank-app redirects or file selection. |
| Sharing | Actual documents OIDC and budget access with Basic/Admin roles; Sure documents per-account view/annotation/full-control permissions. These are more developed than Ufer's shared-password workspace, but are not audited SaaS isolation guarantees. |
| Privacy | Actual is local-first and offers optional budget E2EE; bank tokens and local-device storage are outside that protection. Ufer only encrypts bank-session secrets. No equivalent financial-data E2EE was established for the other products. |
| Recovery | Actual documents export/restore. Firefly's CSV export is not a complete database restore. Sure's stable release adds instance backup/restore; external object storage needs separate consideration. No recovery trial was completed in this review. |

Sources: [Actual sharing](https://actualbudget.org/docs/config/multi-user/), [encryption](https://actualbudget.org/docs/getting-started/sync/), [backup](https://actualbudget.org/docs/backup-restore/backup/) and [restore](https://actualbudget.org/docs/backup-restore/restore/); [Sure clients](https://docs.sure.am/guides/key-concepts/clients), [sharing](https://docs.sure.am/guides/app-features/family-sharing), [stable release](https://github.com/we-promise/sure/releases/tag/v0.7.6-hotfix.1) and [compose](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/compose.example.yml); [Firefly exports](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/firefly-iii/exporting-data.md).

## Verification record

| Check | Observed result | What it does not prove |
| --- | --- | --- |
| Actual container | Pinned 26.11.0 image started; UI reported matching app/server versions | Successful bank connection, production setup or long-term operation |
| Actual synthetic demo | Budget allocations/carryovers, off-budget assets/debts, scheduled entries and existing split rows were visible; transaction-entry controls opened | A saved custom split, import round trip, schedule execution or calculation audit |
| Actual CSV upload | Import control opened file selection; automation's upload operation was denied by its browser policy | Neither import success nor an Actual product defect; no overlap/dedup test passed |
| Sure deployment attempt | Image retrieval failed with a host macOS keychain credential-helper error, before app containers started | A Sure setup/product failure; no logged-in runtime workflows were accepted |
| Sure pinned source | Securities/holdings/source-identity/lock structures, worker scheduler registration, dashboard order/visibility preferences and size-preset controls inspected at stable tag | Complete UI correctness, executed widget interactions, execution of scheduled jobs or all rolling-doc behavior shipping in stable |

A supplied, unversioned saved Sure UI was inspected locally for provider configuration controls; application ID/client-certificate fields and multiple provider choices were visible. This is static UI evidence, not an executed authorization test. No personal snapshot content is included here. Firefly III and Buxfer findings remain documentation-based. No real bank authorization, real broker import, physical-phone trial, performance measurement or restore trial was performed. Temporary Actual review container was removed; no application data in this repository was changed. Synthetic fixtures and host-specific logs are not committed.

## Follow-up acceptance scenarios

Use the same synthetic amounts and outcomes for shortlisted tools. These are pending checks, not completed tests.

1. **First-use and mobile:** reach a useful overview, find a transaction, change its category and change a report period without advanced configuration; verify touch, keyboard, narrow layout and bank redirect return.
2. **Imports and corrections:** import overlapping history, sync again, retain a manual correction and a split, deliberately delete an imported entry and check whether it returns; reconcile counts and totals.
3. **Investments:** identify one instrument/listing, record a buy with fees and a sell, separate settlement cash, set/update a price and verify holdings, currency and wealth history without double counting.
4. **Reports and planning:** obtain common spending/wealth answers using defaults, alter the dashboard layout, and verify rollover/overspending and recurring-entry behavior against the chosen model.
5. **Unattended operation and restore:** close browsers, run the scheduler, inspect failures/reconnects, export/back up and restore to a fresh isolated instance with matching balances and metadata.

Use Actual as a budgeting/reporting reference and Sure as a combined wealth-workflow reference. Ufer remains the selected implementation; use the scenarios above as requirements and acceptance checks without presenting unimplemented competitor features as shipped Ufer behavior.
