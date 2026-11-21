---
title: "Separate users, workspaces, billing and bank consent"
adr:
  id: "XXX"
  status: proposed
  date: 2026-11-15
  authors:
    - Ufer maintainers
---

# Separate users, workspaces, billing and bank consent

## Context

Ufer needs the same understandable ownership model for self-hosting and hosting, future SSO, operator-managed bank credentials and strong isolation between customers. The current singleton-workspace model does not isolate customers.

## Decision

Propose User and Identity for people/login, Workspace and Membership as the financial authorization boundary, optional workspace BillingCustomer for hosted subscriptions, operator ProviderApplication for credentials, and workspace BankConnection/AuthorizationAttempt for consent. Require verified workspace context at every financial access boundary and preserve financial account identity on reconnect. Use OIDC through a maintained identity library; Better Auth is now selected for the singleton installation under [ADR 005](005-username-password-authentication.md). Full multi-customer scoping and SSO remain proposed.

## Consequences

The model supports individual and household use without conflating a bank account, a login or a paying customer. Implementation requires explicit schema/backfill changes, per-request/job/callback enforcement, recovery design and cross-workspace tests. No new tenant tables, SSO login or SaaS isolation is implemented by the documentation/refactor.

## Compliance

Review the detailed model and permission matrix before implementation. Test swapped resource IDs, revoked membership, callback replay, worker scope and migration data preservation with two synthetic workspaces. Approve existing-data migration effects separately.

## Notes

[Detailed target architecture and ER diagram](../../architecture-target.md), [banking product journey](../../product-direction.md#bank-connection-experience-and-credential-ownership).
