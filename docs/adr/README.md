# Architecture decisions

This is Ufer's own decision registry. Records use YAML frontmatter for future documentation rendering and remain readable directly on GitHub. No organization-specific workflow is required.

## Conventions

| Concern | Convention |
| --- | --- |
| Records | `docs/adr/decisions/`; retired records remain in `decisions/inactive/` |
| Header | YAML `title` and `adr` metadata; IDs are strings |
| Lifecycle | Unnumbered `XXX-` proposals; accepted/rejected decisions receive the next unused three-digit number |
| Template | `decisions/template.md`; use Context, Decision, Consequences, Compliance and Notes |
| Validation | `git diff --check`, local-link/frontmatter review, and the code checks relevant to an implemented decision |

Accepted describes an approved direction; each record separately states its implementation boundary. Proposed designs do not authorize schema migrations or publication. Preserve rejected/superseded decisions and fix links when moving them. Do not reuse numbers.

## Registry

| Record | Status | Scope |
| --- | --- | --- |
| [001 — Continue Ufer](decisions/001-continue-ufer.md) | Accepted | Independent Node/React product; no Sure fork |
| [002 — Modular application](decisions/002-modular-monolith.md) | Accepted | HTTP, server use cases, components and styles |
| [003 — Versioned SQL changesets](decisions/003-sql-changesets.md) | Accepted | Migration tooling and explicit existing-database upgrades |
| [004 — Maintained security libraries](decisions/004-security-libraries.md) | Accepted | jose provider JWTs and stored-secret format; session portion superseded by 005 |
| [Workspaces, identity and banking](decisions/XXX-workspaces-identity-and-banking.md) | Proposed | Customer boundaries, self-hosting/hosting and future SSO |
| [005 — Username/password authentication](decisions/005-username-password-authentication.md) | Accepted | Better Auth, explicit enrollment and singleton-workspace access |
| [006 — Client server state](decisions/006-client-server-state.md) | Accepted | TanStack Query for server state, URL for view/filter state, no global client store; per-area queries and independent mutation states |
| [007 — Client UI and URL state](decisions/007-client-ui-and-url-state.md) | Accepted | Typed URL hooks per parameter, a Zustand store for dialogs, feedback and the session lock, form-local drafts; amends 006 |
| [008 — Transaction types and transfers](decisions/008-transaction-types-and-transfers.md) | Accepted | Explicit type per transaction, linked transfer bookings, unambiguous automatic pairing; amended 2026-11-20 for rule-set types and transfer accounts |
| [009 — Manual account balances from transactions](decisions/009-manual-account-balances-from-transactions.md) | Accepted | Manual transactions, balances as the sum of transactions, Update balance as an adjustment, transfers between manual accounts editable from either side |
| [010 — Bank-linked account balances from transactions](decisions/010-bank-account-balances-from-transactions.md) | Accepted | Every balance from transactions, an opening balance from the first booked bank balance, reported bank balances kept for comparison and reconciled by an adjustment |
