# Security boundaries and maintained libraries

Ufer currently has one operator-configured installation password, not an individual-user identity system. Browser sessions use [iron-session](https://github.com/vvo/iron-session); Enable Banking application JWTs use [jose](https://github.com/panva/jose). Neither session sealing/expiry nor JWT serialization/signing is implemented by Ufer.

## Installation authentication

The [auth feature](../src/features/auth/server/session.ts) configures iron-session using `SESSION_SECRET`, a seven-day lifetime and HttpOnly, SameSite=Lax cookies. The library handles authenticated encryption, cookie parsing, seal verification, expiry, saving and destruction. API handlers call the library's session lifecycle rather than constructing signatures or setting session cookies themselves.

There is no universally mandated session-cookie name. Ufer uses the conventional `session` over HTTP and `__Host-session` when `APP_URL` is HTTPS. The HTTPS configuration sets Secure and Path=/ and never sets Domain, satisfying the browser-enforced [host-cookie prefix rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes). The prefix is a standard security constraint; the word `session` is a naming convention. Old `budget_session` cookies are not accepted; users sign in again after this change.

The password is an operator-managed environment secret (`APP_PASSWORD`), not a persisted user credential. Its check uses Node's constant-time primitive over fixed-size digests; there is no custom password-hash/KDF storage format. The existing shared, database-backed sign-in limit is retained as application policy so spoofing a client-IP header does not bypass it. Origin checks remain a separate HTTP requirement on writes, including login and logout; a session library does not replace authorization or CSRF policy.

iron-session is stateless: logging out clears the current browser's cookie but does not create a central revocation record for a separately copied cookie. Secret rotation invalidates existing seals. Individual users, enrollment/recovery, OIDC and server-side revocation belong to the proposed workspace/identity implementation and require its reviewed schema changes. Better Auth is a candidate for that complete identity layer; iron-session is not claimed to supply it.

## Provider JWTs and saved bank secrets

The [provider client](../src/features/banking/server/enable-banking-client.ts) uses jose's SignJWT for RS256, issuer/audience claims, application key ID and a five-minute expiry. Node's key parser handles standard RSA PEM input; Ufer does not assemble or sign base64 JWT segments itself. Bank consent remains browser-bound and single-use through the existing authorization-attempt record; a successful bank callback does not sign a user into Ufer.

The [secret-box module](../src/server/security/secret-box.ts) is a small adapter over Node's standard AES-256-GCM implementation. Its IV/tag/ciphertext serialization is already persisted in bank connections. This change preserves that format and DATA_ENCRYPTION_KEY; changing it would require an explicit data migration. An immutable synthetic ciphertext fixture checks that stored values remain readable, and a modified authentication tag is rejected. Do not introduce a second encryption format or copy secrets into session cookies.

Scheduler bearer checks and one-time-token digests live in shared job/security infrastructure. They use Node's standard hash/constant-time primitives, not a home-grown authentication protocol. Provider credentials, session secrets and encryption keys stay in operator-managed configuration.

## Ownership and verification

| Area | Owner |
| --- | --- |
| Feature login/session policy and throttling repository | `src/features/auth/server/` |
| Bank application protocol and consent workflow | `src/features/banking/server/` |
| Request origin/error boundary | `src/server/http/` |
| Persisted secret format and token primitives | `src/server/security/` |
| Scheduler access and coordination | `src/server/jobs/` |

Tests exercise real iron-session seals with Ufer's configured cookie policy, tampering and expiry; provider JWTs are cryptographically verified against the generated public key and required claims. Existing checks cover sign-in throttling, single-use browser-bound bank callbacks and stored-secret integrity. Production HTTP checks must also exercise the actual Next.js cookie lifecycle. These checks do not establish tenant isolation, SSO support or independent security certification.
