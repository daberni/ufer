---
title: "Use a modular monolith with explicit feature responsibilities"
adr:
  id: "002"
  status: accepted
  date: 2026-11-15
  authors:
    - Ufer maintainers
---

# Use a modular monolith with explicit feature responsibilities

## Context

The initial catch-all handler mixed HTTP routing, validation, SQL and financial operations. One dashboard component and a large global stylesheet mixed unrelated views and interactions.

## Decision

Keep one Next.js application with idiomatic filesystem HTTP routes, shared HTTP guards, server feature use cases/repositories, client feature components/hooks and CSS Modules for owned styling. Route files can export several HTTP methods for a resource; responsibility follows feature boundaries, not an imposed one-file-per-operation rule. Retain a JSON-404 catch-all only. Import shared visual primitive styles directly; use CSS Modules composition for genuine local selectors/variants rather than forwarding-only modules. Enforce readable statements, whitespace and dependency boundaries with ESLint, CSS formatting and review.

Own a business feature's UI and backend together under `src/features/<feature>/`, placing its server-only code in `server/`. Reserve root `src/server/` for shared database, HTTP, security and job infrastructure. Do not maintain two separate feature hierarchies split solely by client/server execution.

## Consequences

More focused files make changes easier to assess. Cross-feature coordination remains necessary; avoid generic service layers and interfaces with no concrete purpose. Banking services coordinate provider access and focused repositories rather than a general-purpose store. Normalization/categorization return data; repositories own queries and atomic transactions. The current banking/security model remains single-workspace and needs scoped adaptation before hosted use.

## Compliance

Run lint, stylesheet checks, type checking, behavior tests and a production build. Check responsive navigation/forms and API behavior after extraction. Keep SQL out of HTTP routes and server imports out of browser features.

## Notes

[Code style](../../code-style.md), [architecture](../../architecture.md).
