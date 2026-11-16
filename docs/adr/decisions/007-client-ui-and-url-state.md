---
title: "Own dashboard URL and UI state with typed hooks and a small store"
adr:
  id: "007"
  status: accepted
  date: 2026-11-16
  authors:
    - Ufer maintainers
---

# Own dashboard URL and UI state with typed hooks and a small store

## Context

[ADR 006](006-client-server-state.md) moved server state to TanStack Query and kept the view and filters in the URL. It left "URL-derived values, dialog selection and transient feedback" in a dashboard context. That context grew into `useDashboard`, a controller of about 47 fields: URL filters and their setters, the open dialog and three separate dialog selections, page feedback, the session lock, the bank directory form and the CSV import mode. The context value was a new object on every render, so every keystroke in a dialog field re-rendered the shell and the view under the dialog (on Transactions, 50 rows with two category pickers each). Eighteen components typed their props as `Pick<DashboardController, …>`.

Dialogs opened in two steps (`setSelectedX(...)`, then `setModal("x")`). A missing selection rendered an empty dialog, selections were never cleared, and a new dialog needed edits in four places.

Constraints: Next.js 16 App Router; dashboard views are routes under one persistent client layout that is also rendered on the server per request. Next.js integrates `window.history.pushState` and `replaceState` into its router, so `usePathname` and `useSearchParams` follow them, and it recommends reading `window.location` in event handlers that only write the URL. `useSearchParams` is a single context: every component that reads it re-renders on any change of the query string.

## Decision

State has three kinds and each kind has one owner. There is no controller object and no prop that forwards one.

| State | Owner |
| --- | --- |
| Server data: accounts, transactions, reports, categories, rules, connections, sync runs, bank directories | TanStack Query, unchanged ([ADR 006](006-client-server-state.md)) |
| View, period, currency, search, account, category, sync run, page | The URL, through typed hooks per parameter and plain setter functions |
| Page-level feedback, session lock, the period remembered for views without one | A Zustand store per dashboard layout, read through selectors |
| Whether a dialog is open, and the data it shows | The component that opens it |
| Field drafts: bank country and search, chosen bank, CSV import mode, transaction search draft | The form or field component that edits them |

**URL state uses a small in-house module, not nuqs.** `use-dashboard-url.ts` provides `useView`, `usePeriod`, `useCurrency`, `useSearchFilter`, `useAccountFilter`, `useCategoryFilter`, `useSyncRunFilter`, `usePage`, the combined `useDashboardQuery` for the transaction list, and link helpers. Each hook parses only through the tested pure functions in `dashboard-location.ts`, so a component reads exactly the parameters it uses. Writes are plain functions (`selectPeriod`, `setCurrency`, `setSearch`, `setPage`, …) that read `window.location` when called and write with `pushState` or `replaceState`; components that only change the URL therefore do not subscribe to it. The existing rules stay: default values are left out of the URL, a filter change resets the page, typing a search replaces its history entry, the list filters apply only on the transactions view, and views without a period link back to the last period selected on a view with one.

nuqs 2 was evaluated. It offers typed parsers, `clearOnDefault`, push/replace history modes, batched multi-key updates and URL write throttling, and supports Next.js 16. It was not adopted because:

- its App Router adapter is itself built on `useSearchParams`, so it does not narrow re-renders below what the in-house hooks achieve;
- the dashboard's URL rules span routes (a period remembered across views without one, list filters valid on one route only) and would remain application code on top of it;
- the parsing and writing rules already exist as small, tested pure functions, and the hooks around them are a few dozen lines;
- it would add a root adapter and a dependency for nine parameters.

Revisit nuqs if URL state spreads to many routes or needs throttled writes or shared parsers across features.

Every component that reads a URL hook re-renders when any query parameter changes. This is accepted: URL writes are discrete actions (a click, a selection, or a search committed 250 ms after typing pauses), never single keystrokes. The persistent shell passes the current route as `children`, so a shell update does not re-render the route's view.

**Client UI state uses a Zustand vanilla store.** `DashboardStoreProvider` creates one store per mounted dashboard layout and supplies it through context; components read it with `useDashboardStore(selector)` and re-render only when the selected value changes. Actions are part of the store and stable, so selecting an action never re-renders. The store holds:

- `feedback`: the page-level message for results without a surviving trigger (a bank callback, a failed rule toggle, an unconfirmed revocation), also bound to its pathname;
- `locked`: whether the sign-in form replaces the dashboard; locking still clears the query and mutation caches as ADR 006 requires and also drops page feedback;
- `periodScope`: the period and currency last selected on a period-aware view.

Page feedback belongs to the view it was reported on: it is hidden as soon as the pathname differs and cleared after the navigation, including Back and Forward.

**Dialogs belong to their openers, not the store** (amended 2026-11-16, issue #107). Each feature owns its dialog components, built on the shared `Dialog` primitive in `src/components/ui/dialog.tsx`. The component that opens a dialog keeps whether it is open in local state, as a discriminated union when it opens several, and renders the dialog with its data as props, for example `{dialog?.kind === "balance" && <ValuationDialog selectedAccount={dialog.account} close={closeDialog} />}`. A dialog therefore cannot open without its data, and adding one touches only its feature and its opener. A dialog closes when its opener unmounts: navigating to another view, including Back and Forward, unmounts the view, and locking replaces the dashboard with the sign-in form. An opener that outlives navigation, such as the account button in the persistent header, closes its dialog itself when the pathname changes. The first version of this record kept the open dialog and its payload in the store behind a central `DashboardDialogs` switch; that put every feature's dialog into the dashboard and coupled the store to each payload type.

Zustand was chosen over a hand-written store on React's `useSyncExternalStore`. Both use the same primitive; Zustand provides the selector subscription with a server snapshot, `useShallow`, optional devtools middleware and a documented pattern for a store per request in Next.js, at about 1 kB with no runtime dependencies or install scripts. A hand-written store would be about 40 lines, but the application would own those edge cases and their tests. The store is created per provider rather than as a module singleton because the layout renders on the server per request and tests need isolated stores.

This record amends ADR 006 where it said the dashboard context carries dialog selection and transient feedback. ADR 006's rule that no client store holds server data still applies: the store never contains query results.

**Implementation boundary.** Implemented for the `(dashboard)` layout and its views. `useDashboard`, `DashboardController`, the dashboard context, the central `DashboardDialogs` switch and `modalTitles` are removed. Issue #106 moved the URL module (`dashboard-location.ts`, `use-dashboard-url.ts`), the store and the session lock to `src/client`, because feature components read them directly, and moved shared types, presentation and helpers out of the dashboard feature.

## Consequences

- Typing in a dialog or the search field re-renders only that form or field; the shell and the view below a dialog stay unchanged until a URL write or a mutation result.
- Components declare what they use: URL hooks, store selectors and queries instead of controller props. Tests render a component with a store provider instead of building a controller.
- Opening a dialog without its data is a type error; a stale selection cannot leak into the next dialog, because closing unmounts the dialog with its data.
- `zustand` is a new runtime dependency without install scripts.
- A reload still resets dialogs, feedback and the remembered period of views without one; the URL keeps everything else.

## Compliance

- Behavior tests cover URL parsing and writing (defaults left out, page reset, history entries), the remembered period, store transitions (feedback, leaving a view, lock and unlock), the dialog primitive's dismissal and the existing lifecycle tests (401 lock, bank callback feedback, page correction).
- Review rejects server data in the store, controller objects forwarded as props, dialog state in the store and dialogs opened without their data.
- A render check with the React profiler or render counting confirms that typing in a dialog field or the search field renders only that form or field.

## Notes

[ADR 006](006-client-server-state.md), [architecture](../../architecture.md#client-request-lifecycle), [Next.js native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api), [`useSearchParams`](https://nextjs.org/docs/app/api-reference/functions/use-search-params), [Zustand with Next.js](https://zustand.docs.pmnd.rs/guides/nextjs), [nuqs](https://nuqs.dev). Issue #105; dialogs amended by #107; related #106.
