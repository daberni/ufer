# Security boundaries and maintained libraries

The working-tree implementation uses Better Auth for individual username/password authentication and jose for Enable Banking application JWTs. The hosted installation remains on its previous login until an explicitly approved migration and rollout. See [user management](user-management.md) for configuration, enrollment, access limits and rollout effects.

## User authentication and financial authorization

The [auth feature](../src/features/auth/server/auth.ts) delegates credentials, sessions and database-backed rate limiting to Better Auth 1.7.25. BETTER_AUTH_SECRET protects the library's standard session cookie. Passwords are library-hashed; session storage is revocable and cookie caching is disabled. There is no anonymous development bypass, public registration, custom session protocol or shared installation-password fallback.

Ufer separately requires active membership of the existing installation workspace for every financial API request. The schema prevents adding a second independent customer while financial repositories remain installation-wide. Both owner and member roles can access these shared finances. Multi-customer SaaS, SSO, email verification/recovery and member-administration UI remain unimplemented.

Origin checks apply to writes, including sign-in and sign-out. Authentication failures retain Problem Details and trace IDs alongside the fields required by the maintained library client. Provider/library secrets and raw failures are not logged. All clients share persistent endpoint rate limits because unverified forwarded IP headers are not trusted. This favors protection against spoofing over per-client availability; a trusted-proxy policy is a separate future decision.

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

Tests exercise real library-managed signup/sign-in, duplicate and concurrent enrollment, membership denial/revocation, cookie integrity/expiry, logout, password/session revocation, persistent rate limiting across instances and the maintained client's Problem Details handling. Provider JWTs, stored-secret integrity and actor-bound single-use bank callbacks have separate regression coverage. These checks do not establish live deployment acceptance, multi-customer isolation, SSO support or independent security certification.
