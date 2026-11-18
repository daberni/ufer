# HTTP errors and correlation

The [HTTP boundary](../src/server/http/respond.ts) emits [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html) for errors, including failures returned as Response objects. The [shared serializer](../src/server/http/problem-response.ts) also handles unknown API endpoints. Successful JSON responses, redirects and session/bank-flow cookies retain their normal behavior.

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "The amount has too many decimal places.",
  "instance": "urn:uuid:742e52de-c68f-4688-b934-9a2aba3911c8",
  "traceId": "c4e10ba54dbe4d1682d472ebcb62ec376"
}
```

The response uses `application/problem+json`, `Cache-Control: no-store` and an `X-Trace-Id` header matching the body. The instance URI identifies this particular error occurrence and is not a diagnostics endpoint. It contains no request URL, query parameters or financial identifiers. An existing active, valid [OpenTelemetry span](https://opentelemetry.io/docs/languages/js/instrumentation/#get-the-current-span) supplies its trace ID; otherwise a random 128-bit correlation ID is generated. Caller-provided X-Trace-Id headers are not trusted. This does not configure an exporter, collector or complete distributed tracing. The client shows the trace ID of 5xx failures as separate, copyable secondary text below the message, never inside it; it takes the ID from the body or, when an intermediary answered, from the header.

| Failure | HTTP status | Public detail |
| --- | --- | --- |
| HttpError | Its explicit 4xx/5xx status | Deliberately safe application message |
| Shared ValidationError | 422 | User-correctable input explanation, including CSV content and category selection |
| Rejected provider data | 502 | Safe bank-data explanation, without provider values |
| JSON syntax / Zod structure validation | 400 | Generic invalid-input message, without submitted values |
| Unexpected exception | 500 | Generic message, without exception text or cause |
| Returned error Response | Its 4xx/5xx status | Standard status description; original body is discarded |

Expected failures are logged as warnings and unexpected 500 errors as errors. Both carry the same trace ID, instance URI and status as the response, plus exception type. Raw messages, stack/cause chains, request URLs, SQL parameters and request/response payloads are excluded. Relevant response headers such as Retry-After are retained when normalizing returned error responses; stale payload length/encoding headers are removed.

HttpError is intentionally permitted in services, repositories and infrastructure as well as route guards. Missing resources (404), account/connection conflicts (409), import size limits (413), rate limits (429) and unavailable configuration (503) retain explicit HTTP outcomes; no additional exception hierarchy is required. Semantic user-input validation uses ValidationError instead of HttpError(422). Request/query syntax remains 400.

Input origin determines error classification. An invalid decimal amount in uploaded CSV is 422, while the same rejected amount received from the bank is 502. The bank-data boundary translates only expected ValidationError failures and leaves unexpected exceptions private. Provider responses that do not match the validated response schemas, missing transaction identifiers, conflicting provider references, unsupported balances, mismatching transaction currencies and missing bank-account identities are provider failures; ambiguous mappings against existing local accounts remain state conflicts (409). The sync and authorization catch policies remain unchanged: known HttpError messages may be shown, while other exceptions use generic messages.

The [browser transport](../src/client/api.ts) reads detail/title and keeps status, traceId and instance on the thrown error. The dashboard read lifecycle uses the same translation. The scheduler records failed HTTP runs with diagnostic identifiers instead of reporting them as successful syncs. No compatibility field for the previous error/requestId shape is retained.

Framework-generated responses outside this boundary, such as an unsupported method's automatic 405, and transport-level failures before routing are not rewritten. The banking callback intentionally redirects the browser back to the dashboard with a safe result rather than returning an API error document. HEAD responses cannot carry an error body.

The [HTTP behavior tests](../tests/http-errors.test.ts) cover the error contract, status preservation, trace correlation, malformed input, private-data suppression, origin rejection, returned-error normalization, client translation and CSV/provider classification. [Repository checks](../tests/repositories.test.ts) verify provider rejection without financial writes. The classification regressions failed against the previous 422 handling before the implementation changed.

Production HTTP verification with a disposable synthetic database covered 400, 401, 403, 404, 422 and 500 responses, matching body/header/log correlation, withheld submitted/query values, session login/logout and unchanged successful responses. Subsequent source-classification regressions verify 422 for CSV input versus 502 for rejected bank data. All 45 behavior tests, lint, stylesheet formatting, type checks and the production build passed. No existing user database was migrated.

## Maintained authentication client

The Better Auth handler retains RFC 9457 Problem Details for failures and adds message/code extensions used by its maintained React client. Trace correlation, no-store headers and sanitized diagnostics remain unchanged. Native library success responses and Set-Cookie headers are preserved. The actual maintained client is exercised against the handler to verify that errors remain readable; authentication uses no legacy login/status/logout response compatibility layer. Unexpected library failures receive generic details.
