# Product and architecture direction

Updated: 2026-11-21. Ufer is the current working product name. This document records requirements and design direction; proposed capabilities are not presented as implemented.

## Why build when alternatives already synchronize banks?

The [functional review](functional-review.md) and [feature matrix](feature-comparison.md) show that Ufer currently has substantially less functionality than the established alternatives. [Actual](https://actualbudget.org/docs/advanced/bank-sync/) and [Firefly III](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md) already cover bank imports. [Sure](https://docs.sure.am/guides/key-concepts/investment-accounts) combines banking, transaction management, investments, and budgets. Manual correction protection, configurable imports, and wealth history are not unique proposed Ufer features.

The proposed Ufer workflow starts with automatic bank synchronization and a focused mobile overview across institutions, with explicit provenance, supporting imports, and securities identified by compatible instrument and venue identifiers. This is a preference and a set of requirements, not an established unmet need. Sure's ticker-and-MIC identification fits the accepted direction; a dedicated ISIN field is not an adoption prerequisite. Actual's off-budget balances and retirement simulations do not establish a holdings-and-trades engine.

**Decision: continue Ufer independently in Node.js/TypeScript and React.** Rails unfamiliarity, long-term fork maintenance and a materially different hosted credential model outweigh the benefit of adopting Sure for this project. Sure and Actual remain functional references; competitor feature parity is not the launch scope. See the [accepted decision](adr/decisions/001-continue-ufer.md) and [architecture](architecture.md).

Ufer still owns financial correctness, integration upkeep, upgrades and operations. Good UI and stack familiarity do not remove that work. [Code style](code-style.md) and explicit feature boundaries govern implementation; the [workspace/identity/banking design](adr/decisions/XXX-workspaces-identity-and-banking.md) is proposed and does not claim implemented tenant isolation or SSO.

## Audience, onboarding, and reports

Ufer targets ordinary people who want a clear view of their money, rather than users who want to configure a finance system. Broad functionality should be available through sensible defaults and plain-language workflows. Visual quality, smartphone usability, and low setup effort are product requirements; this review does not claim that an alternative is unusable solely because its appearance is not preferred.

In the future hosted service, guide a new user through signing in, choosing a supported bank, authorizing access, and reaching a useful overview populated by automatic synchronization. File import is a secondary path for historical data or unsupported sources, not the default onboarding journey. Infrastructure, database, scheduling and provider application configuration belong to the service operator. Users should not need to bring API keys for the normal supported bank-connect flow. This is a target experience, conditional on commercial provider access, not a capability of the current MVP. Keep self-hosted operation available with explicit setup documentation.

Reports should answer common questions without building a report first: money available, income versus spending, category trends, changes in wealth, and investment value when sufficient data exists. Default widgets must distinguish transfers from expenses and contributions from investment returns, and show period, currency, freshness and missing observations. Advanced filters and custom reports are optional detail.

Use an optional widget edit mode inspired by mobile operating systems: add/remove widgets, move them and choose supported sizes. Start with a useful layout; users do not need to customize it to understand their finances. On phones, reflow into a readable order and use constrained sizes rather than shrinking a desktop dashboard. Provide move/resize controls as alternatives to dragging, preserve layouts, and allow resetting the layout without affecting data. These interactions remain planned; today's fixed dashboard is not a widget editor.

Actual's [report dashboards](https://actualbudget.org/docs/reports/) demonstrate the value of customizable report collections. Adopt the principle of adaptable presentation while keeping Ufer's default experience approachable. Matching Actual's analytical breadth is not a launch requirement, and listing many report types is not proof of everyday usability.

## Bank connection experience and credential ownership

The primary hosted journey is: Connect bank → choose country/bank → authorize with the bank/provider → return to Ufer → review connected accounts and the initial sync result. Reconnect repeats the consent journey, preserving the intended account identity and history. Users must not register provider applications, enter application IDs, upload client certificates, copy tokens/secrets, or configure callback URLs. Ask for consent and account choices when required by the provider; do not promise to remove bank authentication or required provider disclosures.

Separate application authentication from user consent. The service operator configures the provider application, callback registrations and server-side credentials. The backend starts authorization and completes the callback; the user only approves account access. Enable Banking documents [redirect authorization and session creation](https://enablebanking.com/docs/api/reference/), authenticated separately with the application's signed JWT. A redirect-based bank-consent experience does not mean every upstream API uses the same OAuth protocol.

Choose the appropriate adapter internally for the selected institution where feasible. The ordinary user journey should not begin with a list of provider SDKs or credential forms. Each supported integration must have a usable delegated authorization flow or an equivalent provider-managed linking journey. An API that only supports user-generated personal tokens cannot gain delegated OAuth simply by wrapping its form; such integrations remain explicit advanced options or outside the main supported journey until a suitable connector exists.

| Responsibility | Owner / requirement |
| --- | --- |
| Provider application registration, commercial access and credentials | Hosted service operator; managed server-side, never distributed in the frontend or a public image |
| Account authorization and renewed consent | End user, through the bank/provider flow, with clear access scope and connection status |
| Callback handling and account association | Backend; bind one-time state to the initiating signed-in user and connection, handle cancellation/retry, and preserve reconnect identity |
| Secret/session lifecycle and daily synchronization | Backend/operations; protect credentials, scope financial access correctly, and expose understandable failures rather than asking users to handle tokens |
| Smartphone return path | Product acceptance; bank-app handoff and browser return must resume the correct connection or explain recovery without exposing credentials |

Current Ufer already keeps Enable Banking application configuration in server environment settings and provides a consent/callback flow verified in sandbox. It does not yet provide the intended multi-user hosted service. Sure's reviewed self-hosted setup has provider credential configuration before bank consent; that is a setup/usability difference, not evidence that it lacks authorization flows or that a managed installation could never simplify them.

For self-hosting, distinguish the instance operator from an ordinary finance user. Direct provider operation may require administrator credentials and registration. If a future self-hosted edition must also avoid that setup, evaluate an optional managed connection service with explicit costs, trust/data boundaries and provider eligibility. That architecture is undecided; do not bundle shared production secrets into downloadable software or promise credential-free independent hosting merely by adding an OAuth button.

## Sync-first value proposition

Reliable automatic account synchronization is essential to the intended mainstream experience, not an optional convenience. Everyday use should continue without recurring statement downloads, CSV preparation, or an open browser. The current sandbox flow does not establish production bank compatibility. Consent expiry, reconnects, stale data and sync failures need understandable status and recovery paths.

Basic category tagging and budgets alone are an insufficient proposed reason to pay when a user's banking app already provides them. The value hypothesis is a coherent view across institutions and investments: consolidated balances and spending, correct treatment of transfers between own accounts, wealth history, useful default reports, and less manual maintenance. Compare against the aggregation and analytics a user's existing bank apps actually offer; cross-bank aggregation is not assumed to be unique to Ufer.

The positioning is therefore a simple, continuously maintained overview of money across institutions, rather than another category editor or a CSV-centered budgeting tool. This remains a hypothesis about customer value and willingness to pay, not validated demand. Configurable imports and exports remain important for history, unsupported sources and portability, but manual files must not become the primary everyday workflow.

## Database providers

**Implemented:** SQLite locally and remote libSQL through `@libsql/client`. This already covers a zero-configuration NAS installation and persistent external storage for Vercel. It is one SQL family, not generic PostgreSQL support.

**Target:** support SQLite/libSQL and PostgreSQL as explicit adapters behind shared domain-facing repositories. A universal SQL string wrapper is insufficient: placeholders, dates, conflict handling, booleans, transactions, migrations, and concurrency differ across engines.

| Concern | Direction |
| --- | --- |
| Application boundary | Domain repositories for accounts, transactions, imports, portfolios, and sync coordination; business rules do not depend on a driver |
| Provider selection | Validated server configuration selects SQLite/libSQL or PostgreSQL; reject unsupported combinations clearly |
| Schema lifecycle | Versioned migrations per engine, backup instructions, and upgrade tests; no destructive automatic migration of existing user data |
| Financial correctness | Exact amounts and quantities, idempotent imports, atomic splits, and manual override preservation must behave the same on both engines |
| Validation | Run consequential repository behavior tests against both providers before marking PostgreSQL supported |

PostgreSQL is a reasonable target for managed hosting, but a database switch alone does not create a SaaS product. Tenant isolation and authorization must exist at every data access boundary. Current sandbox/production isolation separates provider environments; it is not tenant isolation. Versioned SQLite/libSQL SQL changesets are implemented; no existing user database was upgraded by the refactor. PostgreSQL remains unimplemented. See the [migration workflow](database-migrations.md).

## Free self-hosting and paid managed hosting

The intended business model is a freely self-hostable application plus a paid managed service. Payment would cover hosting, scheduled jobs, updates, backups, monitoring, and support. No prices or paid feature restrictions are decided. A free hosted tier with one synchronized account and paid access to additional accounts is a candidate to evaluate, not an accepted price plan or an implemented limit.

For that candidate, define the billing unit before promising “one account”: one bank authorization can expose several accounts, and one institution can require more than one login. A one-bank-connection allowance may be easier to explain than an arbitrary account cutoff, but this is an alternative hypothesis, not a decided replacement. The distinction between source accounts, provider connections and billable units must be explicit.

A free hosted allowance should demonstrate real automatic synchronization and useful reports. The multi-account overview may be the strongest reason to subscribe, so a one-account allowance can hide that value; compare it with a time-limited full-product trial before deciding. Establish provider contract terms and costs for free as well as paid users, expected sync/hosting costs and observed usage first. Free self-hosted software does not imply free third-party banking service or managed operation.

Open-source software and charging for services are compatible; the [GNU guidance on selling free software](https://www.gnu.org/philosophy/selling.en.html) explicitly permits commercial distribution and support. Ufer is licensed under [AGPL-3.0-or-later](../LICENSE). The license does not prevent other providers from offering paid hosting; anyone who runs a modified version for other users must offer those users its source code. Contributions are accepted under a [contributor license agreement](../CLA.md) that also allows the maintainer to use them in a hosted offering and to relicense them. The license grants no rights to the Ufer name or icon.

Enable Banking's [restricted production mode](https://enablebanking.com/docs/api/linked-accounts/) covers evaluation and individual non-commercial access to linked own accounts. Managed multi-customer access requires checking commercial terms and obtaining the appropriate agreement. Provider costs and eligibility must be established before promising a hosted bank-sync plan.

Before SaaS operation, extend the current singleton-workspace user management with full customer isolation, operational secret management, durable jobs, restore-tested backups, monitoring, billing, and a data retention/deletion policy. The current constrained single-workspace user model is not suitable for multiple independent customers.

## Required unattended synchronization

Sync must run while all browsers are closed on every supported hosting platform. Docker includes its scheduler in the default stack and Vercel has a protected cron route today. A deployment must include and verify its scheduler; it cannot be advertised as supported with only a manual refresh button.

Keep scheduling separate from the banking provider. Use concurrency control, idempotent imports, persisted outcomes, visible failures and consent expiry, and recovery after restarts. Serverless installations may need durable workers when provider calls exceed request limits. Do not assume identical consent durations across institutions.

## Transaction editing and provenance

**Implemented:** transaction types separate from categories with linked transfers, manual transactions on manual accounts (create, edit, delete), payee and description overrides on imported and synced bookings that survive later syncs and imports, hiding imported bookings so later syncs and imports keep them out of balances and reports, and split bookings across categories. Sync runs are linked to the transactions they inserted. **Remaining:** per-run linkage for CSV imports, a complete source trail in the UI, and a decision on date or amount overrides for imported bookings ([#246](https://github.com/daberni/ufer/issues/246)).

| Requirement | Intended behavior |
| --- | --- |
| Provenance | Link every imported transaction to provider/institution, source account, stable external reference, import or sync run, and retrieval time. CSV imports retain their import profile/batch and source filename metadata without publishing uploaded files. |
| Original source | Retain the normalized original values and enough source identity for traceability. Decide raw payload retention and privacy limits explicitly. |
| User corrections | Store explicit overrides separately from source values; show which fields were changed. Subsequent sync updates source data without silently replacing manual corrections. |
| Manual transactions | Support creating, editing, and deleting entries. Define reconciliation with subsequent imports rather than relying only on display text. |
| Deleted imported entries | Preserve a suppression/tombstone rule so a later sync does not silently recreate a deliberately deleted entry. |

Original amounts and parsed provider fields are stored for synced bookings, and the raw provider transaction is kept when its serialized form is at most 64 KiB (larger payloads keep only the parsed fields). Overrides are stored separately from source values. CSV imports are not yet linked to an import run, and the UI does not show a complete source trail. Schema changes require explicit migrations.

**Implemented:** split bookings allocate an original booking across categories; the parts sum exactly to the booking amount and count once in cash flow and spending. Buxfer split rows import as split bookings. Defined behavior for refunds and transfers within splits remains open.

## Import configuration

Imports support historical backfill, unsupported sources and migration; exports support portability. Manual CSV import/export is not the intended primary workflow or a replacement for reliable automatic bank synchronization.

**Implemented:** a CSV import page with a preview, detected and editable delimiter, encoding, date and decimal conventions, column roles chosen in the preview, a stable ID column, per-source account mapping (existing, new manual or skipped), category mapping with the category picker, a pre-import summary, and saved mapping templates. Buxfer exports are detected with a built-in mapping, including split rows.

**Remaining:** standard bank formats such as OFX/QIF and CAMT.053 ([#14](https://github.com/daberni/ufer/issues/14)) and duplicate detection between bank sync and CSV imports ([#228](https://github.com/daberni/ufer/issues/228)). PDF support remains a separate future decision, not a prerequisite.

## Securities and valuations

Security-level tracking is required beyond recording a single investment account balance. Proposed domain objects are securities, trading venues, holdings, security transactions, price observations, and portfolio valuations.

| Area | Requirement |
| --- | --- |
| Identification | Accept compatible combinations of identifiers, such as ticker + venue/MIC, or ISIN plus listing/venue details. Preserve name, quote currency and provider-specific aliases when available. ISIN is optional and alone does not identify the venue or quotation; a ticker also needs context. Resolve identifiers to a canonical instrument and explicit listing without merging different currencies or venues silently. |
| Holdings | Exact quantities and trade events, fees and currencies; separate settlement cash from securities to avoid double counting |
| Prices | Manual price entry initially; later quote-provider adapters with timestamps, venue/currency, source, freshness and licensing information |
| Valuation | Market value derived from holdings and an explicit price observation; optional FX conversion must be visible and reproducible |
| History | Portfolio and total-net-worth timelines based on dated valuations; do not silently substitute current prices into historical observations |

No market-data provider is selected. Price availability, venue coverage, redistribution rights, and commercial SaaS use need validation. Published competitor portfolio features are not evidence that every broker or instrument works reliably. Performance and tax reporting require additional decisions about cost basis, cash flows, and corporate actions.

## Repository privacy and language

Maintain documentation, code comments, UI copy, API messages, and synthetic examples in English. Preserve existing user-entered data; translating source defaults is not permission to rewrite a user's stored categories or transactions.

Repository content must describe a generic product. Do not include personal institution lists, account inventories, real balances, IBANs, application identifiers, local user paths, private keys, financial exports, or screenshots of real data. Generic financial concepts and supported data types belong to the application model and are not a statement about its owner's finances.

## Roadmap

Open work in priority order. Items without an issue are not yet specified.

1. **Backups:** restore-tested, automated backups of the database and keys ([#84](https://github.com/daberni/ufer/issues/84), high priority, being designed).
2. **Data quality:** reconcile bank-linked balances with booked transactions ([#183](https://github.com/daberni/ufer/issues/183)), detect duplicates across bank sync and CSV imports ([#228](https://github.com/daberni/ufer/issues/228)), and let rules apply only to a chosen account ([#243](https://github.com/daberni/ufer/issues/243)).
3. **Product:** an insights page with configurable reports ([#249](https://github.com/daberni/ufer/issues/249)) and application localization ([#21](https://github.com/daberni/ufer/issues/21)).
4. **User management (later):** owner and member roles exist, but routes do not yet enforce different rights; role enforcement has no issue yet.
5. **Securities price automation (later):** automatic price updates for securities; a provider (EODHD) is under evaluation and no issue exists yet.

In progress: dropping the per-row banking environment column ([#76](https://github.com/daberni/ufer/issues/76)), completing management of rules, categories, accounts and bank links ([#86](https://github.com/daberni/ufer/issues/86)). JSX accessibility linting ([#111](https://github.com/daberni/ufer/issues/111)) waits for an ESLint 10-compatible `eslint-plugin-jsx-a11y` release.

## Decisions still open

Commercial banking agreement, market-data provider (EODHD under evaluation), SaaS pricing/free-tier eligibility and billing unit, and detailed PostgreSQL adapter implementation are not settled. The accepted functional priorities are tracked in the [feature comparison](feature-comparison.md#tracked-work).
