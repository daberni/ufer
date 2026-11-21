---
title: "Delegate session and JWT protocols to maintained libraries"
adr:
  id: "004"
  status: accepted
  date: 2026-11-15
  authors:
    - Ufer maintainers
---

# Delegate session and JWT protocols to maintained libraries

## Context

A single security utility mixed a custom HMAC browser session, password checking, bank-secret encryption, request-origin checks and scheduler authorization. Provider JWTs were serialized and signed manually. The current deployment has an installation password but no user/identity tables; introducing a full account system would require a separate schema and ownership migration.

## Decision

Use iron-session for the installation browser session and jose for provider JWTs. Use `session` on HTTP and `__Host-session` on HTTPS with the required host-bound attributes. Remove the previous custom session implementation and accept a fresh sign-in rather than retaining a cookie-compatibility layer. Keep password/rate-limit policy in the auth feature and HTTP/job/token concerns in their shared infrastructure modules.

Preserve the persisted AES-GCM bank-secret format using Node's standard implementation; changing stored ciphertext requires an explicit migration. Do not mistake this focused session change for the proposed individual-user/SSO architecture. Re-evaluate a complete maintained identity library, including Better Auth, when implementing that model with user credentials, recovery and server-side revocation.

## Consequences

Security protocol lifecycle is delegated to maintained packages. Shared environment-secret checks, origin authorization and existing database throttling remain small application policies. Sessions remain stateless and do not provide central per-session revocation. No user tables, tenant backfill or stored-secret migration is performed.

## Compliance

Verify HTTPS cookie attributes, HTTP fallback, real library round trips, tampering, expiry and Next.js login/logout. Verify provider JWT claims/signatures and persisted bank-secret fixtures. Run production dependency audit, type checks, tests, build and isolated HTTP acceptance.

## Notes

[Security boundaries](../../security.md), [iron-session](https://github.com/vvo/iron-session), [jose](https://github.com/panva/jose), [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication).

The installation-session portion is superseded in current source by [ADR 005](005-username-password-authentication.md). The provider JWT and stored-secret decisions remain in effect.

Rolled out to production 2026-11-16.
