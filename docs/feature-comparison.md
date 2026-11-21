# Feature comparison

Updated: **2026-11-21** · Ufer `0.2.0` · Working product name: **Ufer**

How Ufer compares with established personal finance tools, and what is still planned. Details and evidence are in the footnotes; workflows and release pins in the [functional review](functional-review.md), and priorities in the [roadmap](product-direction.md#roadmap). No personal account inventory is included.

| Legend | |
| --- | --- |
| ✅ | Supported |
| ◐ | Partial (see footnote) |
| ❌ | Not supported |
| 🧪 | Experimental or preview |
| ❔ | Not assessed or not established by the reviewed sources |

| Product | Reviewed release | Deployment · license |
| --- | --- | --- |
| **Ufer** | `0.2.0` | Self-hosted (Docker/NAS) or Vercel + libSQL · AGPL-3.0-or-later |
| [Buxfer](https://www.buxfer.com/features/) | hosted, unpinned | Hosted subscription · proprietary |
| [Actual Budget](https://github.com/actualbudget/actual/releases/tag/v26.11.0) | 26.11.0 | Self-hosted Node server · MIT |
| [Firefly III](https://github.com/firefly-iii/firefly-iii/releases/tag/v6.7.9) | 6.7.9 + Importer 2.3.5 | PHP app, database, importer, cron · AGPLv3 |
| [Sure](https://github.com/we-promise/sure/releases/tag/v0.7.6-hotfix.1) | 0.7.6-hotfix.1 | Rails, PostgreSQL, Redis · AGPLv3 |

## Feature matrix

| Feature | Ufer | Buxfer | Actual | Firefly III | Sure |
| --- | :---: | :---: | :---: | :---: | :---: |
| **Banking and sync** | | | | | |
| Bank balances and transactions | ✅[¹](#fn-1) | ✅[²](#fn-2) | ✅🧪[³](#fn-3) | ✅[⁴](#fn-4) | ✅[⁵](#fn-5) |
| ↳ Connect, reauthorize, remove | ✅ | ✅[²](#fn-2) | ✅[³](#fn-3) | ✅[⁶](#fn-6) | ✅[⁵](#fn-5) |
| ↳ No user-supplied provider credentials | ◐[⁷](#fn-7) | ✅[²](#fn-2) | ◐[³](#fn-3) | ◐[⁶](#fn-6) | ◐[⁵](#fn-5) |
| ↳ Sync with all browsers closed | ✅[⁸](#fn-8) | ✅[²](#fn-2) | ◐[⁹](#fn-9) | ✅[⁴](#fn-4) | ✅[¹⁰](#fn-10) |
| ↳ Verified with production banks | ◐[¹¹](#fn-11) | ❔ | ❔ | ❔ | ❔ |
| **Accounts and wealth** | | | | | |
| Cash, card, investment, property and loan accounts | ✅ | ✅[¹²](#fn-12) | ✅[¹³](#fn-13) | ✅[¹⁴](#fn-14) | ✅[¹⁵](#fn-15) |
| ↳ Manual assets and liabilities | ✅[¹⁶](#fn-16) | ✅[²](#fn-2) | ✅[¹³](#fn-13) | ✅[¹⁴](#fn-14) | ✅[¹⁵](#fn-15) |
| ↳ Rename, archive, convert, delete | ✅ | ❔ | ❔ | ❔ | ❔ |
| ↳ Per-account balance history | ✅ | ❔ | ❔ | ❔ | ❔ |
| Net worth | ✅ | ✅[¹²](#fn-12) | ✅[¹³](#fn-13) | ✅[¹⁷](#fn-17) | ✅[¹⁵](#fn-15) |
| ↳ Historical net-worth chart | ◐[¹⁸](#fn-18) | ✅[¹²](#fn-12) | ✅[¹³](#fn-13) | ◐[¹⁷](#fn-17) | ✅[¹⁵](#fn-15) |
| Multiple currencies | ◐[¹⁹](#fn-19) | ✅[¹²](#fn-12) | ❌[²⁰](#fn-20) | ✅[²¹](#fn-21) | ✅[²²](#fn-22) |
| **Transactions** | | | | | |
| Search and filters | ✅ | ✅[¹²](#fn-12) | ✅[²³](#fn-23) | ✅[²⁴](#fn-24) | ✅[²⁵](#fn-25) |
| Manual transactions | ✅[²⁶](#fn-26) | ✅[¹²](#fn-12) | ✅[⁹](#fn-9) | ✅[²⁷](#fn-27) | ✅[²⁵](#fn-25) |
| Edit imported transactions | ◐[²⁸](#fn-28) | ✅[¹²](#fn-12) | ✅[⁹](#fn-9) | ✅[²⁷](#fn-27) | ✅[²⁵](#fn-25) |
| ↳ Hide imported transactions | ✅ | ❔ | ❔ | ❔ | ❔ |
| ↳ Corrections survive resync | ✅ | ❔ | ❔ | ❔ | ✅[²⁹](#fn-29) |
| Split transactions | ✅ | ✅[³⁰](#fn-30) | ✅[³¹](#fn-31) | ✅[²⁷](#fn-27) | ✅[²⁵](#fn-25) |
| Transfers between own accounts | ✅[³²](#fn-32) | ❔ | ❔ | ❔ | ❔ |
| Payee suggestions | ✅ | ❔ | ❔ | ❔ | ❔ |
| Source provenance | ◐[³³](#fn-33) | ◐[²](#fn-2) | ◐[²³](#fn-23) | ◐[³⁴](#fn-34) | ✅[²⁹](#fn-29) |
| **Categorization** | | | | | |
| Categories with color and icon | ✅ | ❔ | ❔ | ❔ | ❔ |
| ↳ Category hierarchy or tags | ❌ | ✅[¹²](#fn-12) | ✅[⁹](#fn-9) | ◐[¹⁴](#fn-14) | ✅[³⁵](#fn-35) |
| Automatic categorization rules | ✅[³⁶](#fn-36) | ✅[¹²](#fn-12) | ✅[³⁷](#fn-37) | ✅[³⁸](#fn-38) | ✅[²⁵](#fn-25) |
| ↳ Rules set type and transfer account | ✅ | ❔ | ❔ | ✅[³⁸](#fn-38) | ❔ |
| ↳ Create a rule from a transaction | ✅ | ❔ | ✅[³⁷](#fn-37) | ❔ | ❔ |
| **Imports** | | | | | |
| CSV import with mapping and preview | ✅ | ◐[³⁹](#fn-39) | ✅[²³](#fn-23) | ✅[⁴](#fn-4) | ✅[⁴⁰](#fn-40) |
| ↳ Saved import templates | ✅ | ❔ | ❔ | ✅[⁴](#fn-4) | ✅[⁴⁰](#fn-40) |
| ↳ Buxfer export detection | ✅ | — | ❔ | ❔ | ❔ |
| OFX, QIF or CAMT.053 | ❌ | ❔ | ❔ | ❔ | ❔ |
| Duplicate detection on reimport | ◐[⁴¹](#fn-41) | ✅[²](#fn-2) | ✅[²³](#fn-23) | ✅[³⁴](#fn-34) | ◐[⁴⁰](#fn-40) |
| **Reports** | | | | | |
| Monthly income and spending | ✅[⁴²](#fn-42) | ✅[¹²](#fn-12) | ✅[¹³](#fn-13) | ✅[¹⁷](#fn-17) | ✅[¹⁵](#fn-15) |
| ↳ Spending by category | ✅ | ✅[¹²](#fn-12) | ✅[¹³](#fn-13) | ✅[¹⁷](#fn-17) | ✅[¹⁵](#fn-15) |
| ↳ Savings rate | ✅ | ❔ | ❔ | ❔ | ❔ |
| Customizable dashboards | ❌ | ❔ | ✅[¹³](#fn-13) | ◐[¹⁷](#fn-17) | ✅[⁴³](#fn-43) |
| Cash-flow forecasts | ❌ | ✅[¹²](#fn-12) | 🧪[¹³](#fn-13) | ❔ | ◐[⁴⁴](#fn-44) |
| **Planning** | | | | | |
| Budgets | ❌ | ✅[¹²](#fn-12) | ✅[⁴⁵](#fn-45) | ✅[⁴⁶](#fn-46) | ✅[³⁵](#fn-35) |
| Recurring transactions and bills | ❌ | ✅[¹²](#fn-12) | ✅[⁴⁷](#fn-47) | ✅[⁴⁸](#fn-48) | ✅[⁴⁴](#fn-44) |
| Long-term planning | ❌ | ✅[¹²](#fn-12) | ✅🧪[¹³](#fn-13) | ◐[¹⁴](#fn-14) | ◐[¹⁵](#fn-15) |
| **Investments** | | | | | |
| Investment account value | ✅ | ✅[⁴⁹](#fn-49) | ✅[¹³](#fn-13) | ◐[⁵⁰](#fn-50) | ✅[⁵¹](#fn-51) |
| Securities, holdings and trades | ❌[⁵²](#fn-52) | ✅[⁴⁹](#fn-49) | ❔ | ❌[⁵⁰](#fn-50) | ✅[⁵¹](#fn-51) |
| ↳ Instrument identity (ISIN, venue) | ❌ | ❔ | ❔ | ❌[⁵⁰](#fn-50) | ✅[²⁹](#fn-29) |
| ↳ Market prices and performance | ❌ | ✅[⁴⁹](#fn-49) | ❔ | ❌[⁵⁰](#fn-50) | ✅[²²](#fn-22) |
| **Platform** | | | | | |
| Self-hosting | ✅ | ❌ | ✅ | ✅ | ✅ |
| ↳ Serverless hosting (Vercel) | ✅ | — | ❌ | ❌ | ❌ |
| Phone-friendly web app | ✅[⁵³](#fn-53) | ✅[¹²](#fn-12) | ✅[⁵⁴](#fn-54) | ◐ | ✅[⁵⁵](#fn-55) |
| ↳ Installable web app | ✅ | ❔ | ❔ | ❔ | ❔ |
| Dark mode | ✅ | ❔ | ❔ | ❔ | ❔ |
| Multiple users | ◐[⁵⁶](#fn-56) | ✅[¹²](#fn-12) | ✅[⁵⁷](#fn-57) | ❔ | ✅[⁵⁸](#fn-58) |
| ↳ Single sign-on | ❌ | ❔ | ✅[⁵⁷](#fn-57) | ❔ | ❔ |
| Local-first or end-to-end encryption | ❌ | ❔ | ✅[⁵⁹](#fn-59) | ❔ | ❔ |
| Export and restore | ◐[⁶⁰](#fn-60) | ✅[¹²](#fn-12) | ✅[⁶¹](#fn-61) | ◐[⁶²](#fn-62) | ✅[⁶³](#fn-63) |
| Open source | ✅ | ❌ | ✅ | ✅ | ✅ |

Low resource use is a Ufer goal, not a measured advantage; no comparative performance or security benchmark was run. Actual 26.11.0 was started locally with its demo data, Sure's stable source was inspected, and Firefly III and Buxfer were assessed from official sources. Sure's rolling documentation is a draft and can lead its stable release. Provider directories do not prove that a particular bank works.

**Verification limits.** Not yet verified: repeat syncs and reauthorization with production banks, the first unattended scheduled sync on each host, physical phones, Safari and real bank-app redirects, large histories, NAS operation, restoring from a backup, PostgreSQL and multi-tenant hosting.

**Positioning.** Ufer currently offers less than the established alternatives; bank sync, editable imports and historical wealth exist elsewhere, and Sure also covers securities. Ufer targets everyday users with automatic bank sync, one view across institutions, simple onboarding and useful default reports; imports serve history and portability. The decision to continue Ufer rather than fork Sure is recorded in [ADR 001](adr/decisions/001-continue-ufer.md).

## Bank providers

| Product | Documented integrations |
| --- | --- |
| Ufer | Enable Banking |
| Buxfer | Yodlee and Salt Edge |
| Actual Budget | Enable Banking (experimental), GoCardless (no new accounts), SimpleFIN, Akahu, Pluggy |
| Firefly III | Separate Data Importer for files and providers, including Enable Banking |
| Sure | Enable Banking, SimpleFIN, Plaid, Akahu and others; stable support varies per adapter |

All products depend on provider eligibility, bank endpoints, consent and available history. Restricted personal provider access is not a commercial multi-customer agreement; see [commercial requirements](product-direction.md#free-self-hosting-and-paid-managed-hosting).

## Tracked work

An item is checked only when its acceptance criterion is met and evidence is recorded. Priorities are in the [roadmap](product-direction.md#roadmap).

### Reliability and data

- [ ] **E-01 · Live bank acceptance**
  - [x] Production consent and first sync with two institutions
  - [x] Provider data validation, session revocation and per-client sign-in limits
  - [ ] Repeat syncs, reauthorization and the unattended daily sync over time ([#267](https://github.com/daberni/ufer/issues/267))
- [ ] **E-02 · Configurable CSV**
  - [x] Preview, column mapping, account and category choices, saved templates
  - [x] Buxfer detection and split import
  - [ ] OFX, QIF and CAMT.053 ([#14](https://github.com/daberni/ufer/issues/14))
  - [x] Content matching against earlier CSV imports of other files
  - [ ] Remaining duplicate detection gaps ([#228](https://github.com/daberni/ufer/issues/228))
- [ ] **E-03 · Backup and restore**
  - [x] Offline backup verification and synthetic restore rehearsal
  - [ ] Automated backups and a restore drill on a fresh instance ([#84](https://github.com/daberni/ufer/issues/84))
- [ ] **E-04 · PostgreSQL adapter**
  - [x] Versioned SQLite/libSQL migrations
  - [ ] Provider-independent repositories and a verified PostgreSQL adapter
- [ ] **E-05 · Unattended deployment**
  - [x] Docker scheduler and protected Vercel cron
  - [ ] Verified first unattended run per host, visible failures, real phones and bank-app redirects

### Product capabilities

- [ ] **K-01 · Editing, provenance and splits**
  - [x] Manual transactions on manual accounts
  - [x] Transaction types and linked transfers
  - [x] Payee and description overrides, hiding imported bookings
  - [x] Split transactions
  - [x] Sync runs linked to the bookings they inserted
  - [ ] CSV import runs linked to their bookings
  - [ ] Date and amount overrides for imported bookings ([#246](https://github.com/daberni/ufer/issues/246))
- [ ] **K-02 · Complete management**
  - [x] Rules: create, edit with preview, toggle, reorder, delete, apply
  - [x] Categories: create, edit, delete with reassignment
  - [x] Accounts: rename, change type, archive, convert detached bank accounts, delete
  - [x] Bookings on archived accounts stay categorizable ([#271](https://github.com/daberni/ufer/issues/271))
  - [x] Bank connections: connect, reconnect, remove
  - [ ] Account-scoped rules ([#243](https://github.com/daberni/ufer/issues/243))
- [ ] **K-03 · Securities** ([#266](https://github.com/daberni/ufer/issues/266))
  - [x] Market-data provider evaluated ([#269](https://github.com/daberni/ufer/pull/269))
  - [ ] Brokerage accounts with holdings, buys and sells
  - [ ] Daily valuations in net worth and its history
- [ ] **K-04 · Planning:** budgets, recurring entries and forecasts; planning model to be agreed first
- [ ] **K-05 · Historical wealth**
  - [x] Per-account balance history
  - [x] Overview net-worth curve for the last year
  - [ ] Full net-worth chart with missing-data states ([#87](https://github.com/daberni/ufer/issues/87))

### Usability and reports

- [ ] **UX-01 · Simple onboarding:** guided hosted bank connection without provider setup by users
- [ ] **UX-02 · Useful report defaults**
  - [x] Monthly cash flow, category breakdowns, net and savings rate
  - [x] Net worth with composition
  - [ ] Long-term category trends and wealth or investment summaries ([#249](https://github.com/daberni/ufer/issues/249))
- [ ] **UX-03 · Optional widget editing**
- [x] **UX-04 · Responsive loading:** server-resolved session, immediate app frame, per-area loading
- [ ] **UX-05 · Localization** ([#21](https://github.com/daberni/ufer/issues/21))
  - [x] Amounts, numbers and dates in the browser's locale
  - [ ] Translated interface
- [x] **UX-06 · Dark mode**
- [x] **UX-07 · Installable web app**

### Before an open-source or managed release

- [ ] **OSS-01 · License and provider terms**
  - [x] AGPL-3.0-or-later, CLA and source link on every screen
  - [ ] Third-party notices for prebuilt images or the managed service
  - [ ] Commercial Enable Banking agreement and market-data rights
- [ ] **OSS-02 · Publication privacy:** scan the tree and history for secrets and real financial data
- [ ] **OSS-03 · Fresh setup and demo**
  - [x] Synthetic demo data (`npm run demo:seed`)
  - [ ] Verified setup from a fresh checkout and container configurations
- [ ] **OSS-04 · Contribution and security process**
  - [x] Contribution guidelines, CLA and security policy
  - [x] Security assessment findings tracked
  - [ ] CLA Assistant connected
- [ ] **OSS-05 · Managed-hosting readiness:** tenant isolation, enforced roles, durable jobs, backups and monitoring, billing

## Footnotes

1. <a id="fn-1"></a>Enable Banking; booked transactions only. The raw provider transaction (up to 64 KiB) and the original amount of foreign-currency payments are stored.
2. <a id="fn-2"></a>[Buxfer sync](https://www.buxfer.com/features/sync/)
3. <a id="fn-3"></a>[Actual bank sync](https://actualbudget.org/docs/advanced/bank-sync/): several providers; provider setup before consent; Enable Banking experimental.
4. <a id="fn-4"></a>[Firefly III Data Importer](https://github.com/firefly-iii/data-importer): separate component; needs provider credentials, import configuration and a scheduled trigger.
5. <a id="fn-5"></a>[Sure Enable Banking](https://docs.sure.am/providers/enable-banking): reconnect workflow; the self-hosted UI asks for application credentials before consent.
6. <a id="fn-6"></a>[Enable Banking with the Firefly III importer](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md)
7. <a id="fn-7"></a>The operator configures the provider once; users only authorize at their bank. No managed connection service yet.
8. <a id="fn-8"></a>Docker includes a daily scheduler; Vercel runs a protected daily cron.
9. <a id="fn-9"></a>[Actual API](https://actualbudget.org/docs/api/reference/): the built-in sync interval needs an open app; `runBankSync` allows an external scheduled job.
10. <a id="fn-10"></a>[Sure scheduler](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/config/initializers/sidekiq.rb)
11. <a id="fn-11"></a>Consent and a first sync with two production institutions work; repeat syncs, reauthorization and the unattended daily sync are being verified ([#267](https://github.com/daberni/ufer/issues/267)).
12. <a id="fn-12"></a>[Buxfer features](https://www.buxfer.com/features/)
13. <a id="fn-13"></a>[Actual reports](https://actualbudget.org/docs/reports/): configurable dashboards, off-budget accounts, experimental forecasts and Monte Carlo.
14. <a id="fn-14"></a>[Firefly III features](https://github.com/firefly-iii/firefly-iii#features): asset and liability bookkeeping, categories and tags, savings goals.
15. <a id="fn-15"></a>[Sure documentation](https://docs.sure.am/): wealth history, asset and debt accounts, goals.
16. <a id="fn-16"></a>Every account's balance is the sum of its transactions; updating the balance books an adjustment, and a bank-linked account's difference to its reported booked balance is shown with a one-click adjustment.
17. <a id="fn-17"></a>[Firefly III reports](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/reports.md): configurable reports; free widget layout and an exact net-worth chart unverified.
18. <a id="fn-18"></a>The overview shows a twelve-month net-worth curve without axes or missing-data states; a full chart is planned ([#87](https://github.com/daberni/ufer/issues/87)).
19. <a id="fn-19"></a>Separate totals per currency; no conversion. Foreign-currency bank payments show their original amount.
20. <a id="fn-20"></a>[Actual multi-currency](https://actualbudget.org/docs/budgeting/multi-currency/): unsupported natively; experimental workaround.
21. <a id="fn-21"></a>[Firefly III currencies](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/currencies.md)
22. <a id="fn-22"></a>[Sure market data](https://docs.sure.am/providers/market-data): quote providers and FX.
23. <a id="fn-23"></a>[Actual importing](https://actualbudget.org/docs/transactions/importing/): field, date and delimiter options; IDs and fallback matching.
24. <a id="fn-24"></a>[Firefly III search](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/search.md)
25. <a id="fn-25"></a>[Sure transactions](https://docs.sure.am/guides/app-features/transactions): editing, splits, filters, rules with order and stop-processing.
26. <a id="fn-26"></a>On manual accounts.
27. <a id="fn-27"></a>[Firefly III transactions](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/transactions.md): create, edit, delete, split journals.
28. <a id="fn-28"></a>Category, type, transfer link, payee and description can be changed; date and amount of imported or synced bookings cannot ([#246](https://github.com/daberni/ufer/issues/246)).
29. <a id="fn-29"></a>[Sure schema](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/db/schema.rb): source IDs, manual field locks, ticker and MIC.
30. <a id="fn-30"></a>[Buxfer split transactions](https://buxfer.zendesk.com/hc/en-us/articles/360015881833-Can-I-split-a-single-transaction-across-multiple-tags)
31. <a id="fn-31"></a>[Actual split transactions](https://actualbudget.org/docs/transactions/split-transactions/)
32. <a id="fn-32"></a>Transfers are a transaction type; sync and imports pair opposite bookings on two own accounts automatically.
33. <a id="fn-33"></a>Source reference and sync-run linkage; CSV import runs and an override history are not recorded.
34. <a id="fn-34"></a>[Firefly III duplicate detection](https://github.com/firefly-iii/docs/blob/main/docs/docs/references/data-importer/duplicate-detection.md): import hashes and external IDs.
35. <a id="fn-35"></a>[Sure budgets](https://docs.sure.am/guides/app-features/budgets): category limits, subcategories.
36. <a id="fn-36"></a>Keyword and regular-expression rules on payee and description, in list order, with an impact preview.
37. <a id="fn-37"></a>[Actual rules](https://actualbudget.org/docs/budgeting/rules/): editable rules and payee learning.
38. <a id="fn-38"></a>[Firefly III rules](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/features/rules.md): grouped rules with multiple actions.
39. <a id="fn-39"></a>[Buxfer upload](https://www.buxfer.com/help/upload): CSV and Excel; mapping profiles unverified.
40. <a id="fn-40"></a>[Sure CSV imports](https://docs.sure.am/guides/app-features/csv-imports): mapping, preview, reusable setup; CSV and feed overlap not guaranteed.
41. <a id="fn-41"></a>Rows match earlier imports by export ID or content and existing bookings by amount, date and text; later bank syncs adopt matching imported rows. Remaining gaps are tracked in [#228](https://github.com/daberni/ufer/issues/228).
42. <a id="fn-42"></a>Monthly chart with income, expenses, net and per-month category breakdowns; transfers are excluded.
43. <a id="fn-43"></a>[Sure dashboard source](https://github.com/we-promise/sure/blob/v0.7.6-hotfix.1/app/controllers/pages_controller.rb): reorder, show or hide and resize predefined widgets; runtime not tested.
44. <a id="fn-44"></a>[Sure recurring transactions](https://docs.sure.am/features/recurring-transactions)
45. <a id="fn-45"></a>[Actual envelope budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting/)
46. <a id="fn-46"></a>[Firefly III budgets](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/budgets.md)
47. <a id="fn-47"></a>[Actual schedules](https://actualbudget.org/docs/schedules/)
48. <a id="fn-48"></a>[Firefly III recurring transactions](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/recurring.md): needs cron.
49. <a id="fn-49"></a>[Buxfer investments](https://www.buxfer.com/features/investments/)
50. <a id="fn-50"></a>[Firefly III discussion](https://github.com/orgs/firefly-iii/discussions/10190): no dedicated securities tracking.
51. <a id="fn-51"></a>[Sure investment accounts](https://docs.sure.am/guides/key-concepts/investment-accounts)
52. <a id="fn-52"></a>Planned as the next major topic ([#266](https://github.com/daberni/ufer/issues/266)).
53. <a id="fn-53"></a>Checked in browser emulation; physical phones not yet tested.
54. <a id="fn-54"></a>[Actual 26.11.0 release](https://actualbudget.org/blog/release-26.11.0/); physical phones not tested.
55. <a id="fn-55"></a>[Sure clients](https://docs.sure.am/guides/key-concepts/clients)
56. <a id="fn-56"></a>Individual users with their own sign-in in one shared workspace; no separate customer workspaces or role-based permissions.
57. <a id="fn-57"></a>[Actual multi-user](https://actualbudget.org/docs/config/multi-user/): OIDC, roles and budget access.
58. <a id="fn-58"></a>[Sure family sharing](https://docs.sure.am/guides/app-features/family-sharing)
59. <a id="fn-59"></a>[Actual sync](https://actualbudget.org/docs/getting-started/sync/): local-first, optional end-to-end encryption excluding bank tokens.
60. <a id="fn-60"></a>Manual database and key backup with an offline verifier; no export in the app ([#84](https://github.com/daberni/ufer/issues/84)).
61. <a id="fn-61"></a>[Actual backup](https://actualbudget.org/docs/backup-restore/backup/) and [restore](https://actualbudget.org/docs/backup-restore/restore/)
62. <a id="fn-62"></a>[Firefly III export](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/firefly-iii/exporting-data.md): CSV and API; full restore needs a database backup.
63. <a id="fn-63"></a>[Sure 0.7.6-hotfix.1](https://github.com/we-promise/sure/releases/tag/v0.7.6-hotfix.1): instance backup and restore.

## Maintenance

Primary sources were checked on 2026-11-15. Update a row and its footnote when a capability changes, check a tracked item only after its acceptance criterion is met, and keep repository examples synthetic and English.
