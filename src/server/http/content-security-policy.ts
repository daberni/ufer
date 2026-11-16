import { randomBytes } from "node:crypto";

// next/image renders style="color:transparent" on every image; nonces cannot cover style attributes, so only this exact value is allowed.
const imageStyleAttributeHash = "'sha256-zlqnbDt84zf1iSefLU/ImC54isoprH/MRiVZGskwexk='";

export function createNonce() {
  return randomBytes(16).toString("base64");
}

export function contentSecurityPolicy(nonce: string, development: boolean) {
  // React needs eval in development to rebuild server error stacks; the dev overlay injects style elements without a nonce.
  const scriptSources = development ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'` : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const styleSources = development ? "'self' 'unsafe-inline'" : `'self' 'nonce-${nonce}'`;

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    `style-src ${styleSources}`,
    `style-src-attr 'unsafe-hashes' ${imageStyleAttributeHash}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];

  return directives.join("; ");
}
