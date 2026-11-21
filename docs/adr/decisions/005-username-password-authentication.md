---
title: "Use library-managed username/password authentication"
adr:
  id: "005"
  status: accepted
  date: 2026-11-15
  authors:
    - Ufer maintainers
---

# Use library-managed username/password authentication

## Context

Ufer needs individual username/password identities and revocable sessions. Financial repositories currently serve one installation, so adding arbitrary workspaces would expose globally queried financial data. Existing records and stored bank-secret encryption must survive the change. Hosted migration and deployment are separate approvals.

## Decision

Use Better Auth 1.7.25 with its username plugin, maintained React client and Drizzle adapter on the shared SQLite/libSQL connection. The library owns hashing, credential verification, sessions and persistent rate limits. Ufer owns active workspace membership checks, operator-only enrollment and bank-consent actor binding. Public signup stays closed.

Start with a database-constrained singleton workspace. Provision an owner explicitly and allow operator-provisioned members of those same finances. Do not permit a second independent customer until financial repositories and jobs implement full workspace scoping. Bank callbacks require the initiating user and exact live session as well as the original browser and workspace.

## Consequences

The implementation replaces the installation-password and iron-session code without a compatibility fallback. Existing databases need the reviewed forward migration and a new BETTER_AUTH_SECRET; financial data and DATA_ENCRYPTION_KEY remain unchanged. Existing pending bank flows must restart. The hosted installation is unchanged until an approved rollout.

Invitations, membership-administration UI, email verification/recovery, SSO and multi-customer SaaS remain future work. Authentication errors preserve Problem Details with the message/code extensions used by the maintained client. Untrusted proxy headers are ignored, so endpoint rate limits are shared across clients.

## Compliance

Exercise real enrollment/sign-in, concurrent ownership claims, duplicate credentials, unauthorized/revoked membership, cookie integrity/expiry, logout and password/session revocation. Verify the real client error contract, persistence across auth instances, actor-bound callbacks, explicit migration behavior and preservation of financial records using disposable synthetic databases.

## Notes

This replaces the installation-session portion of [ADR 004](004-security-libraries.md); jose and persisted bank-secret encryption remain unchanged. See [user management](../../user-management.md), [security boundaries](../../security.md) and the still-proposed [multi-customer architecture](XXX-workspaces-identity-and-banking.md).

Rolled out to production 2026-11-16.
