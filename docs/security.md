# Security boundaries and maintained libraries

The working-tree implementation uses Better Auth for individual username/password authentication and jose for Enable Banking application JWTs. The hosted installation remains on its previous login until an explicitly approved migration and rollout. See [user management](user-management.md) for configuration, enrollment, access limits and rollout effects.

## User authentication and financial authorization

The [auth feature](../src/features/auth/server/auth.ts) delegates credentials, sessions and database-backed rate limiting to Better Auth 1.7.25. BETTER_AUTH_SECRET protects the library's standard session cookie. Passwords are library-hashed; session storage is revocable and cookie caching is disabled. There is no anonymous development bypass, public registration, custom session protocol or shared installation-password fallback.

Ufer separately requires active membership of the existing installation workspace for every financial API request. The schema prevents adding a second independent customer while financial repositories remain installation-wide. Both owner and member roles can access these shared finances. Multi-customer SaaS, SSO, email verification/recovery and member-administration UI remain unimplemented.

Origin checks apply to writes, including sign-in and sign-out. Authentication failures retain Problem Details and trace IDs alongside the fields required by the maintained library client. Provider/library secrets and raw failures are not logged. Authentication rate limits are described [below](#authentication-rate-limits).

## Session lifetime and revocation

A session ends after 24 hours without use: `expiresIn` is one day and activity renews it at most once an hour (`updateAge`). This rolling window replaces the previous seven-day window. Better Auth 1.7.25 offers either an absolute lifetime or an inactivity window that renews without an upper bound, not both; the operator chose the inactivity window for daily use, so a stolen session cookie stays usable as long as it is used at least once a day, until sign-out, a password change or revocation from the account dialog. An absolute lifetime (for example OWASP ASVS 4.0.3 requirement 3.3.2 at level 2: 12 hours) would cap that exposure at the cost of signing in again every day.

Every password change revokes all of the user's sessions and issues a fresh one to the browser that made the change. A `before` hook in the [library configuration](../src/features/auth/server/auth.ts) sets the library's `revokeOtherSessions` option on every change-password call, so a client that omits or declines it cannot keep other sessions alive. Operator password recovery revokes every session through `revokeSessionsOnPasswordReset`. Users can additionally sign out other devices or a single session from the account dialog.

## Authentication rate limits

Better Auth stores rate-limit counters in the database, keyed by client address and endpoint, so they persist across instances. Sign-in and password changes allow ten requests per client in a fifteen-minute window; other authentication endpoints use the library defaults.

`TRUSTED_CLIENT_IP_HEADER` names the single request header that carries the client address. Set it only when infrastructure in front of the application replaces that header with the connecting address, so clients cannot choose their own value:

| Deployment | Setting | Basis |
| --- | --- | --- |
| Vercel (production and previews) | `x-forwarded-for` | Vercel [overwrites `x-forwarded-for`](https://vercel.com/docs/headers/request-headers#x-forwarded-for) "to prevent IP spoofing". A proxy placed in front of Vercel would control this header; such a setup needs its own header choice. |
| Docker/self-hosted behind a reverse proxy | The header the proxy sets, for example `X-Real-IP` | The proxy must replace any client value with the remote address, and the application port must be reachable only through it. |
| Docker/self-hosted without a proxy | Empty | Shared counter per endpoint. |

Every other forwarded header is ignored, so a forged header cannot create a fresh counter. Better Auth accepts only a single valid address from the trusted header; a missing, malformed or comma-separated value is not trusted and the request counts against the shared per-endpoint counter. IPv6 addresses are counted per /64 network, the library default, so rotating addresses within one allocation does not reset a counter. Without the setting no header is trusted, because Next.js keeps a client-supplied `x-forwarded-for` and would let a client connecting directly choose its own counter.

Trade-off: per-client counting stops one client from locking every user out of sign-in and password changes, as one counter shared by all clients does. In exchange, an attacker controlling many addresses gets ten attempts per address and window, and users behind one shared address (NAT, carrier-grade NAT, an office network) share a counter. Better Auth 1.7.25 offers no global ceiling across clients without custom rate-limit storage, which Ufer does not add; the twelve-character password minimum bounds online guessing instead. Self-hosted installations without a trusted proxy keep the shared counter and its lockout window.

## Provider JWTs and saved bank secrets

The [provider client](../src/features/banking/server/enable-banking-client.ts) uses jose's SignJWT for RS256, issuer/audience claims, application key ID and a five-minute expiry. Node's key parser handles standard RSA PEM input; Ufer does not assemble or sign base64 JWT segments itself. Bank consent is browser-bound and single-use, additionally bound to the initiating user, exact live authentication session and active workspace membership; a successful bank callback does not sign a user into Ufer.

The [secret-box module](../src/server/security/secret-box.ts) is a small adapter over Node's standard AES-256-GCM implementation. Its IV/tag/ciphertext serialization is already persisted in bank connections. This change preserves that format and DATA_ENCRYPTION_KEY; changing it would require an explicit data migration. An immutable synthetic ciphertext fixture checks that stored values remain readable, and a modified authentication tag is rejected. Do not introduce a second encryption format or copy secrets into session cookies.

Scheduler bearer checks and one-time-token digests live in shared job/security infrastructure. They use Node's standard hash/constant-time primitives, not a home-grown authentication protocol. Provider credentials, session secrets and encryption keys stay in operator-managed configuration.

## Ownership and verification

| Area | Owner |
| --- | --- |
| Feature authentication, membership checks and operator enrollment | `src/features/auth/server/` |
| Bank application protocol and consent workflow | `src/features/banking/server/` |
| Request origin/error boundary | `src/server/http/` |
| Persisted secret format and token primitives | `src/server/security/` |
| Scheduler access and coordination | `src/server/jobs/` |

Tests exercise real library-managed signup/sign-in, duplicate and concurrent enrollment, membership denial/revocation, cookie integrity/expiry, logout, password/session revocation enforced regardless of the client's revocation flag, persistent rate limiting across instances, per-client counting through the configured trusted header, ignored forged forwarded headers and the maintained client's Problem Details handling. Provider JWTs, stored-secret integrity and actor-bound single-use bank callbacks have separate regression coverage. These checks do not establish live deployment acceptance, multi-customer isolation, SSO support or independent security certification.
