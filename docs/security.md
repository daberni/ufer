# Security boundaries and maintained libraries

The working-tree implementation uses Better Auth for individual username/password authentication and jose for Enable Banking application JWTs. The hosted installation remains on its previous login until an explicitly approved migration and rollout. See [user management](user-management.md) for configuration, enrollment, access limits and rollout effects.

## User authentication and financial authorization

The [auth feature](../src/features/auth/server/auth.ts) delegates credentials, sessions and database-backed rate limiting to Better Auth 1.7.25. BETTER_AUTH_SECRET protects the library's standard session cookie. Passwords are library-hashed; session storage is revocable and cookie caching is disabled. There is no anonymous development bypass, public registration, custom session protocol or shared installation-password fallback.

Ufer separately requires active membership of the existing installation workspace for every financial API request. The schema prevents adding a second independent customer while financial repositories remain installation-wide. Both owner and member roles can access these shared finances. Multi-customer SaaS, SSO, email verification/recovery and member-administration UI remain unimplemented.

Origin checks apply to writes, including sign-in and sign-out. Authentication failures retain Problem Details and trace IDs alongside the fields required by the maintained library client. Provider/library secrets and raw failures are not logged. Authentication rate limits are described [below](#authentication-rate-limits).

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

## Browser security headers

Every page response carries a per-request nonce Content-Security-Policy set by the [proxy](../src/proxy.ts) from the [policy builder](../src/server/http/content-security-policy.ts). Next.js reads the nonce from the request's policy while rendering and attaches it to its own scripts and style elements; with `'strict-dynamic'`, chunks those scripts load are trusted too, so no inline script or `'unsafe-inline'` script source is allowed. A static policy in `next.config.ts` would need `'unsafe-inline'` for the inline scripts that carry the App Router payload, and experimental SRI only covers external files. Nonces require dynamic rendering, which every page already uses because the root layout reads the theme cookie; responses are `no-store`, so no cache replays a nonce.

| Directive | Value | Reason |
| --- | --- | --- |
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` | Development adds `'unsafe-eval'`, which React uses to rebuild server error stacks. |
| `style-src` | `'self' 'nonce-…'` | Development uses `'self' 'unsafe-inline'` because the dev overlay injects style elements without a nonce. |
| `style-src-attr` | `'unsafe-hashes'` and the hash of `color:transparent` | next/image renders this style attribute on every image and nonces cannot cover attributes. Styles React applies in the browser use the CSSOM and are not restricted. |
| `img-src` | `'self' data:` | The select indicator is a data-URL SVG in the global stylesheet. |
| `default-src`, `connect-src`, `font-src` | `'self'` | Bank and provider calls run on the server; development HMR uses a same-origin WebSocket. |
| `object-src`, `base-uri`, `frame-ancestors` | `'none'` | No plugins, no `<base>` element, no framing. |
| `form-action` | `'self'` | The bank consent redirect is a top-level navigation, which CSP does not restrict. |

`upgrade-insecure-requests` is omitted: every source is same-origin, and the directive would break installations served over plain HTTP. API routes, static assets and router prefetches skip the proxy because they return no HTML.

`next.config.ts` adds static headers to every response: a Permissions-Policy that disables browser features Ufer does not use, `Strict-Transport-Security: max-age=63072000; includeSubDomains` (browsers ignore it over plain HTTP; no preload) and `poweredByHeader: false`, alongside the existing `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. The application's own 404 page replaces the built-in one, whose inline styles carry no nonce.

## Ownership and verification

| Area | Owner |
| --- | --- |
| Feature authentication, membership checks and operator enrollment | `src/features/auth/server/` |
| Bank application protocol and consent workflow | `src/features/banking/server/` |
| Request origin/error boundary | `src/server/http/` |
| Persisted secret format and token primitives | `src/server/security/` |
| Scheduler access and coordination | `src/server/jobs/` |

Tests exercise real library-managed signup/sign-in, duplicate and concurrent enrollment, membership denial/revocation, cookie integrity/expiry, logout, password/session revocation, persistent rate limiting across instances, per-client counting through the configured trusted header, ignored forged forwarded headers and the maintained client's Problem Details handling. Provider JWTs, stored-secret integrity and actor-bound single-use bank callbacks have separate regression coverage. These checks do not establish live deployment acceptance, multi-customer isolation, SSO support or independent security certification.
