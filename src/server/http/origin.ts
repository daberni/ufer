import { HttpError } from "@/lib/errors";

const localOrigin = "http://localhost:3000";

// Vercel sets these hosts itself; each preview is reachable through its branch alias and its deployment URL.
function previewOrigins() {
  if (process.env.VERCEL_ENV !== "preview") {
    return [];
  }

  const hosts = [process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL];

  return hosts.filter((host): host is string => Boolean(host)).map((host) => `https://${host}`);
}

export function applicationOrigin() {
  const configured = process.env.APP_URL;

  if (configured) {
    return new URL(configured).origin;
  }

  const [previewOrigin] = previewOrigins();

  return previewOrigin ?? localOrigin;
}

export function allowedOrigins() {
  return [...new Set([applicationOrigin(), ...previewOrigins()])];
}

export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin || !allowedOrigins().includes(origin)) {
    throw new HttpError(403, "Invalid request origin.");
  }
}
