import { HttpError } from "@/lib/errors";

// Vercel overwrites this header with the connecting client's address; clients cannot supply their own value.
const vercelClientAddressHeader = "x-vercel-forwarded-for";
const headerName = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/**
 * Request headers that carry a client address set by trusted infrastructure, in priority order.
 * Without one, no address is trusted and rate limits fall back to a shared per-endpoint counter.
 */
export function trustedClientAddressHeaders() {
  if (process.env.VERCEL === "1") {
    return [vercelClientAddressHeader];
  }

  const configured = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();

  if (!configured) {
    return [];
  }

  if (!headerName.test(configured)) {
    throw new HttpError(503, "Configure TRUSTED_CLIENT_IP_HEADER as a single HTTP header name.");
  }

  return [configured];
}
