# Security boundaries and maintained libraries

Ufer uses Better Auth for individual username/password authentication and jose for Enable Banking application JWTs. See [user management](user-management.md) for configuration, enrollment and access limits.

## User authentication and financial authorization

The [auth feature](../src/features/auth/server/auth.ts) delegates credentials, sessions and database-backed rate limiting to Better Auth 1.7.25. BETTER_AUTH_SECRET protects the library's standard session cookie. Passwords are library-hashed; session storage is revocable and cookie caching is disabled. There is no anonymous development bypass, public registration, custom session protocol or shared installation-password fallback.

Ufer separately requires active membership of the existing installation workspace for every financial API request. The schema prevents adding a second independent customer while financial repositories remain installation-wide. Both owner and member roles can access these shared finances. Multi-customer SaaS, SSO, email verification/recovery and member-administration UI remain unimplemented.

Origin checks apply to writes, including sign-in and sign-out. Authentication failures retain Problem Details and trace IDs alongside the fields required by the maintained library client. Provider/library secrets and raw failures are not logged. JSON API bodies are capped at 2 MiB while they are read; other request size limits, including for authentication, come from the hosting layer. Authentication rate limits are described [below](#authentication-rate-limits).

## Session lifetime and revocation

The account dialog signs out other devices through `revoke-other-sessions`; the token-based `/api/auth/revoke-session` endpoint is not exposed.

A session ends after 24 hours without use: `expiresIn` is one day and activity renews it at most once an hour (`updateAge`). This rolling window replaces the previous seven-day window. Better Auth 1.7.25 offers either an absolute lifetime or an inactivity window that renews without an upper bound, not both; the operator chose the inactivity window for daily use, so a stolen session cookie stays usable as long as it is used at least once a day, until sign-out, a password change or revocation from the account dialog. An absolute lifetime (for example OWASP ASVS 4.0.3 requirement 3.3.2 at level 2: 12 hours) would cap that exposure at the cost of signing in again every day.

Every password change revokes all of the user's sessions and issues a fresh one to the browser that made the change. A `before` hook in the [library configuration](../src/features/auth/server/auth.ts) sets the library's `revokeOtherSessions` option on every change-password call, so a client that omits or declines it cannot keep other sessions alive. Operator password recovery revokes every session through `revokeSessionsOnPasswordReset`. Users can additionally sign out all other devices from the account dialog.

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

Provider responses are validated with zod schemas at the provider client before any value is used or stored; see [bank data validation](banking.md). The API authenticates Ufer by JWT and the response by TLS; there is no response signature, so this validation protects against unexpected shapes, not tampering. Rejections log only the failing field paths and issue codes, never provider values.

The [secret-box module](../src/server/security/secret-box.ts) is a small adapter over Node's standard AES-256-GCM implementation with an explicit 16-byte authentication tag length. Its IV/tag/ciphertext serialization is already persisted in bank connections. The format and DATA_ENCRYPTION_KEY are kept; changing it would require an explicit data migration. An immutable synthetic ciphertext fixture checks that stored values remain readable, and a modified authentication tag is rejected. Do not introduce a second encryption format or copy secrets into session cookies.

### Rotating DATA_ENCRYPTION_KEY

The key encrypts only the stored Enable Banking session IDs (`requisitions.session_cipher`). Ufer reads them with a single key, so replacing the key makes every stored session unreadable. Until a re-encryption migration exists, rotate the key by re-establishing the sessions:

1. Back up the database together with the current key.
2. Remove every bank connection in the Bank connections view, including superseded, expired and failed ones, and confirm each removal succeeds; if revocation fails, retry that connection's removal. Scheduled syncs do not retry revocations. Accounts and their history stay.
3. Check that no session remains: `SELECT COUNT(*) FROM requisitions WHERE session_cipher IS NOT NULL` returns 0.
4. Set the new `DATA_ENCRYPTION_KEY` and restart the application.
5. Reconnect the banks; the kept accounts are remapped by their identification hashes.

Rotating without reconnecting requires a versioned re-encryption migration that decrypts each stored session with the old key and encrypts it with the new key in one transaction, with both keys available only while it runs. It is not implemented.

Scheduler bearer checks and one-time-token digests live in shared job/security infrastructure. They use Node's standard hash/constant-time primitives, not a home-grown authentication protocol. Provider credentials, session secrets and encryption keys stay in operator-managed configuration.

## Browser security headers

`next.config.ts` sends the same headers with every response. The Content-Security-Policy is fixed rather than per request: Next.js puts the App Router page data into inline scripts, so the policy allows inline scripts and styles, and limits everything else to the application's own origin.

| Directive | Value | Reason |
| --- | --- | --- |
| `script-src` | `'self' 'unsafe-inline'` | Inline scripts carry the page data. Development adds `'unsafe-eval'`, which React uses to rebuild server error stacks. |
| `style-src` | `'self' 'unsafe-inline'` | Next.js and the development overlay inject style elements and attributes. |
| `img-src` | `'self' data:` | The select indicator is a data-URL SVG in the global stylesheet. |
| `default-src`, `connect-src`, `font-src` | `'self'` | Bank and provider calls run on the server; development HMR uses a same-origin WebSocket. |
| `object-src`, `base-uri`, `frame-ancestors` | `'none'` | No plugins, no `<base>` element, no framing. |
| `form-action` | `'self'` | The bank consent redirect is a top-level navigation, which CSP does not restrict. |

Trade-off: an injected inline script would run. A per-request nonce policy would block it, but needs a proxy on every page request, development exceptions and replacements for Next.js pages that inline unnonced styles. Ufer renders no untrusted HTML (React escapes all output and there is no `dangerouslySetInnerHTML`), so the fixed policy keeps the origin, framing, plugin and form restrictions at a fraction of the complexity. Revisit this if untrusted HTML is ever rendered.

The other headers are a Permissions-Policy that disables browser features Ufer does not use, `Strict-Transport-Security: max-age=31536000` (browsers ignore it over plain HTTP; no `includeSubDomains`, because self-hosted installations do not own their parent domain; no preload) and `poweredByHeader: false`, alongside `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## Dependencies and supply chain

CI rejects high/critical advisories in production dependencies and runs lint, stylesheet checks, type checking, behavior tests, and a production build without real banking credentials. GitHub Actions use version tags. Dependabot checks npm and Actions weekly and waits until ordinary releases are at least seven days old, grouping production dependencies, development dependencies and Actions separately. [Security updates](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown) bypass this cooldown and the weekly version-update schedule; they are not grouped with routine updates. Updates still require review and passing CI and are not automatically merged. Dependabot cannot identify an arbitrary non-security hotfix from its version number; urgent fixes can be updated manually without waiting for the routine schedule.

## Ownership and verification

| Area | Owner |
| --- | --- |
| Feature authentication, membership checks and operator enrollment | `src/features/auth/server/` |
| Bank application protocol and consent workflow | `src/features/banking/server/` |
| Request origin/error boundary | `src/server/http/` |
| Persisted secret format and token primitives | `src/server/security/` |
| Scheduler access and coordination | `src/server/jobs/` |

Tests exercise real library-managed signup/sign-in, duplicate and concurrent enrollment, membership denial/revocation, cookie integrity/expiry, logout, password/session revocation enforced regardless of the client's revocation flag, persistent rate limiting across instances, per-client counting through the configured trusted header, ignored forged forwarded headers and the maintained client's Problem Details handling. Provider JWTs, stored-secret integrity and actor-bound single-use bank callbacks have separate regression coverage. These checks do not establish live deployment acceptance, multi-customer isolation, SSO support or independent security certification.
