---
title: "Manage client server state with TanStack Query"
adr:
  id: "006"
  status: accepted
  date: 2026-11-16
  authors:
    - Ufer maintainers
---

# Manage client server state with TanStack Query

## Context

The dashboard loaded everything through one `/api/state` request and refetched it after every action. A dashboard-wide `busy` flag, set by a shared `perform` helper, disabled unrelated controls: saving a transaction category disabled the Sync button and every other category select. Recent fixes re-implemented caching concerns locally: stale-result detection and out-of-order protection for filter changes (#46) and a per-row serialized save queue with optimistic updates for categorization (#47). Both were paused in favor of a data layer that owns these concerns.

Since #48, routes hold the view and search parameters hold the period, currency and transaction filters, so Back/Forward, reload and links restore them. The dashboard is a client-rendered single-workspace application behind a session; server-side rendering of financial data is not required for its first paint.

## Decision

**Server state uses TanStack Query v5.** A `QueryClientProvider` in the `(dashboard)` layout supplies one browser query client. Each dashboard area reads its own query through a focused, authenticated route handler with an explicit projection:

| Query key | Route | Filters |
| --- | --- | --- |
| `["accounts"]` | `GET /api/accounts` | none |
| `["accounts", "balance-history", account]` | `GET /api/accounts/{id}/balance` | account |
| `["reports", "net-worth", { currency }]` | `GET /api/reports/net-worth` | currency |
| `["reports", "cash-flow", { period, currency }]` | `GET /api/reports/cash-flow` | period, currency |
| `["reports", "cash-flow", "account", { account, period }]` | `GET /api/accounts/{id}/cash-flow` | account, period |
| `["transactions", "list", { period, currency, search, account, category, page }]` | `GET /api/transactions` | every list filter |
| `["categories"]`, `["rules"]` | `GET /api/categories`, `GET /api/rules` | none |
| `["rules", "preview", { pattern, priority }]` | `POST /api/rules/preview` (a read; the draft is posted so payee and remittance text stay out of URLs) | the draft keyword rule; always refetched, below the rules prefix |
| `["banking", "connections"]`, `["banking", "sync-runs"]`, `["banking", "banks", country]` | `GET /api/banking/connections`, `/api/sync/runs`, `/api/banks` | country for the bank directory |

`/api/state` and its client lifecycle are removed. Keys live in one registry (`src/client/query-keys.ts`): the resource comes first, then the serialized filters that select the result, so a write invalidates a whole resource by prefix. Route handlers stay thin, delegate to read projections in the owning feature's `server/` modules and keep RFC 9457 Problem Details and the session/membership check of `respond()`.

**The URL is the source of truth for view and filter state.** Query keys are derived from the URL query; there is no additional global client store (no Redux, Zustand or context store for server data). The dashboard context only carries URL-derived values, dialog selection and transient feedback.

**Defaults.** Reads are fresh for 30 seconds. Data older than that is refetched in the background when a view mounts or the window regains focus, so results changed by the scheduler appear when the user returns, while quick tab switches reuse fresh data. Reads retry once only after a network failure or a 502/503/504 response; 4xx and other 5xx failures are final and shown at once. Writes do not retry. A background refetch never blanks an area, and a row's pending categorization keeps showing over a refetched list.

**Filter changes.** Filter-keyed queries use `placeholderData: keepPreviousData`. While `isPlaceholderData` is true the previous results stay in place; after 250 ms affected values and labels show a pulsing skeleton and larger areas (lists, charts) fade and become inert, so fast responses never flash and unaffected areas never change. A failed request ends loading: the outdated area keeps its layout behind a static "not available" placeholder and a dashboard-level banner, fed from the query cache, offers Retry. The banner stays while a retry runs and disappears only after a successful load; it keeps the last failure itself, because the query cache resets the error of a query without data when it is fetched again. A refetch for unchanged filters keeps the current data visible.

**Every write is a mutation with its own state.** Each control reflects only its own mutation's `isPending` and `error`: the Sync button only its sync, Apply rules only that mutation, each rule switch only its toggle, each dialog only its submit, each transaction row only its categorization. There is no shared `busy` flag, counter or `perform` helper. If operations must not overlap, that is expressed explicitly, with a mutation `scope` on the client or a server lease/409, not through a UI flag. A mutation invalidates the query prefixes it affects in `onSettled` (also after a failure, since a failed write may still have changed server state). Dialog mutations return that invalidation, so a dialog closes once the refreshed data is visible.

**Categorization.** A row's mutation uses `scope: { id: "transaction-category:<id>" }`, so changes to one transaction run in order, also across view changes and remounts, because the mutation cache outlives components. The row shows the variables of its latest pending mutation (optimistic via the UI rather than a cache patch) and otherwise the cached, stored category; a failed change therefore falls back to the last stored category with an inline error. On success the stored assignment returned by `PATCH /api/transactions/{id}` is written into every cached list page, and the list and cash-flow queries are invalidated once the row's last change has settled. This avoids the rollback hazard of overlapping `onMutate` snapshots, where reverting an earlier change would erase a later pending one.

**Authentication.** Any query or mutation rejected with 401 locks the dashboard, except the sign-in mutation, whose 401 means wrong credentials and stays a form error. Locking clears the query and mutation caches, so a late response cannot restore financial data and a pending row change is not shown again; only a successful sign-in unlocks it. Queries run only inside the signed-in shell.

## Consequences

- Areas load, refresh and fail independently; a filter change requests only the areas whose keys changed, and navigating between views reuses cached results.
- Out-of-order responses, request cancellation and deduplication are handled by the library instead of request version counters and abort controllers in application code.
- The first visit to a view issues several small requests instead of one large one. Each request repeats the session lookup; this is acceptable for the single-workspace SQLite deployment and should be revisited with multi-workspace authorization.
- Data changed by the scheduler appears once it is older than the stale time and the window regains focus, a view mounts or a write invalidates it, not immediately.
- `@tanstack/react-query` and `@tanstack/query-core` are new runtime dependencies without install scripts.

### Alternatives considered

- **SWR:** covers caching and revalidation, but mutation pending/error state, mutation scopes for serialized writes, `useMutationState` across components and placeholder data are either missing or hand-built. The categorization requirements would recreate the custom queue this decision removes.
- **Redux Toolkit Query:** comparable caching with tag invalidation, but it requires a Redux store, contradicting the decision to keep the URL as the only view-state source without a global client store, and adds more boilerplate for a single-application API.
- **Zustand (or another client store) with hand-written fetching:** keeps the cache, deduplication, stale detection and request ordering in application code, which is the situation this decision replaces.
- **Server Components / RSC data loading now:** the dashboard depends on client interactions (debounced search, per-row optimistic edits, independent mutation states, dialogs) and a client-side lock after a 401. Moving reads to Server Components would require Server Actions plus `router.refresh()` or cache tags for every write and still a client layer for optimistic rows. TanStack Query can later be hydrated from Server Components (`HydrationBoundary`) if server-rendered first paint becomes a requirement; this decision does not preclude it.

## Compliance

- Behavior tests drive the hooks with controlled responses: per-area loading by filter, the 250 ms no-flash threshold, rapid changes, background refreshes, failures with Retry, the 401 lock race for reads and writes, the retry banner, page correction, serialized per-row categorization across remounts, and an acceptance test that an action in flight leaves the controls of every other action unchanged.
- Review rejects shared busy flags, blanket refetches, server data in a client store, and route handlers without `respond()`.
- Lint, style checks, type checks, tests and the production build run in CI.

## Notes

[ADR 007](007-client-ui-and-url-state.md) amends this record: the dialog with its payload, page feedback and the session lock live in a small UI store instead of the dashboard context, and the URL is read through typed hooks per parameter.

[Architecture](../../architecture.md#client-request-lifecycle), [HTTP errors](../../http-errors.md), [TanStack Query v5](https://tanstack.com/query/v5/docs/framework/react/overview), [mutation scopes](https://tanstack.com/query/v5/docs/framework/react/guides/mutations#mutation-scopes), [optimistic updates via the UI](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates), [Next.js client-side data fetching with TanStack Query](https://nextjs.org/docs/app/guides/client-side-data-fetching/tanstack-query). Issues #49, #7 and #23; replaces the paused pull requests #46 and #47.
