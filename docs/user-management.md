# Username/password user management

Implemented for [issue #25](https://github.com/daberni/ufer/issues/25) and running in production since 2026-11-16.

## Authentication and access

[Better Auth](https://better-auth.com/docs/integrations/next) 1.7.25 owns password hashing, username sign-in, signed session cookies, expiration and server-side revocation. Its [username plugin](https://better-auth.com/docs/plugins/username) and [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) use the existing SQLite/libSQL connection. Provider JWTs remain with jose; bank-secret encryption and DATA_ENCRYPTION_KEY remain unchanged.

Login requires a username and password in development and production. Usernames are normalized by the library. Passwords have 12–128 characters. A session ends after 24 hours without use (see [session lifetime](security.md#session-lifetime-and-revocation)); cookie caching is disabled so revocation is checked against the database. Cookie names use the library defaults: better-auth.session_token on HTTP and __Secure-better-auth.session_token on HTTPS, with HttpOnly, SameSite=Lax, Path=/ and no Domain attribute. BETTER_AUTH_SECRET is required and must have at least 32 characters. APP_PASSWORD and SESSION_SECRET are no longer read.

A valid identity alone grants no financial access. Each financial HTTP request requires an active membership in the installation workspace. Revoking that membership blocks the next financial request even if the authentication session remains valid. Both initial roles can manage this shared workspace's finances; owner identifies installation ownership. Invitations and membership administration in the UI are not implemented.

## Current single-workspace boundary

| Model | Purpose |
| --- | --- |
| auth_users | Personal identity, normalized username, display name and email |
| auth_accounts | Library-managed credentials and future provider identities; distinct from financial accounts |
| auth_sessions | Revocable, expiring sessions belonging to users |
| auth_verifications | Library-managed verification records; public email recovery is not enabled |
| auth_rate_limits | Persistent library-managed authentication rate limits |
| workspaces | The existing installation's financial workspace |
| memberships | Explicit user/workspace access, owner/member role and active flag |

The workspace ID is constrained to personal in the database. Financial repositories still serve this one installation; this change does not establish row-level isolation for several independent customers. The constraint deliberately prevents provisioning a second customer into globally queried financial data. Additional users are members of the same shared finances. Multi-customer SaaS needs the full [workspace architecture](architecture-target.md#data-access-invariants) and two-customer access tests before removing this restriction.

## Operator enrollment

Public registration is closed. The operator runs `npm run user:create`, which accepts an enrollment JSON object on standard input. Supply it from secure operator tooling; do not put passwords in command-line arguments, project files or shell history. Interactive terminal input is refused to prevent accidental plaintext entry.

| Input | Requirement |
| --- | --- |
| username | 3–30 characters; letters, numbers, underscores or periods |
| name | Explicit display name, 1–100 characters |
| email | Explicit valid email address; never inferred from bank data |
| password | 12–128 characters |
| role | owner for the initial owner; member for another person sharing these finances |

The command creates the identity, library-managed credential and membership in one transaction. A second owner bootstrap is refused; member enrollment requires an existing active owner. Concurrent enrollment cannot create a second owner or leave an orphan identity. Duplicate usernames/emails are rejected without granting access or changing existing credentials. The HTTP application never enables enrollment. No first visitor, bank consent or email domain can claim ownership.

A fresh installation initializes the current schema through the normal empty-database lifecycle. An existing installation must complete the reviewed migration before enrollment. Operator access to the database/configuration is required; the public URL and installation's former password are insufficient.

## Account settings and sessions

The account button in the header shows the current identity and allows a password change using the current password. Password changes revoke other sessions and rotate the current session; the server enforces this whatever the client request says. Users can also sign out other devices without changing their password, or sign out the current session. The library performs these operations; Ufer does not write password hashes or session-token formats itself.

The authentication handler exposes only username sign-in, session inspection/revocation and password change. Email sign-in, signup, account linking and email recovery endpoints are not exposed. Password-reset email delivery, invitations, user administration and SSO remain future work. Email addresses are stored as supplied and are not claimed to be verified.

## Operator password recovery

If a user forgets their password, the operator can run `npm run user:reset-password` with email and a new 12–128-character password supplied as secure JSON on stdin. The command invokes the library's request/reset APIs and captures the library's one-time token only in process memory; no reset token is printed or sent by email. Successful recovery invalidates every session for that user. Public recovery endpoints stay closed. This command writes credentials and revokes access, so use it only for an explicitly authorized user recovery.

## HTTP and abuse boundaries

The maintained React client talks to the library handler at /api/auth/[...all]. Library logs are disabled to avoid emitting database parameters or credentials. Origin checks, error responses and rate limits are described in [security boundaries](security.md#user-authentication-and-financial-authorization) and [authentication rate limits](security.md#authentication-rate-limits). Operator enrollment uses the server API and is protected by operator access rather than the HTTP limiter.

Bank authorization attempts are bound to the initiating user, exact authentication session, workspace and browser secret. The callback verifies a live session and active membership before consuming state. Another session, even for the same user, cannot complete that attempt. Logging out, password rotation or membership removal therefore prevents the old flow from completing. Scheduled sync remains operator-authenticated and serves the one installation workspace.

## Migration and rollout

[0001_username_password_authentication.sql](../drizzle/sqlite/0001_username_password_authentication.sql) introduced the identity/access tables and the installation workspace, bound bank authorization records to user, session and workspace, invalidated pending bank flows and dropped the obsolete login counter while preserving financial data. It was rolled out to production on 2026-11-16; APP_PASSWORD and SESSION_SECRET are no longer used. New installations receive it through the normal [migration workflow](database-migrations.md).
