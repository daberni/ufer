import { HttpError } from "@/lib/errors";
import { problemResponse } from "@/server/http/problem-response";
import { requireOrigin } from "@/server/http/origin";
import { readBodyText } from "@/server/http/request-body";
import { authentication } from "./auth";

// Sign-in and password bodies are a few hundred bytes; the cap keeps unauthenticated requests from buffering large bodies.
const maxAuthenticationBodyBytes = 16 * 1024;

const endpoints = new Map([
  ["/sign-in/username", "POST"],
  ["/sign-out", "POST"],
  ["/get-session", "GET"],
  ["/change-password", "POST"],
  ["/list-sessions", "GET"],
  ["/revoke-other-sessions", "POST"]
]);

// The session cookie is the only credential carrier; no response body may repeat the raw session token.
function withoutSessionTokens(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutSessionTokens);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "token").map(([key, item]) => [key, withoutSessionTokens(item)]));
  }

  return value;
}

async function withoutTokens(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }

  const data = await response.json();
  const headers = new Headers(response.headers);

  headers.delete("content-length");

  return Response.json(withoutSessionTokens(data), {
    status: response.status,
    headers
  });
}

// The library reads the body itself, so the capped body is read here and handed over as a new request.
async function withLimitedBody(request: Request) {
  if (request.method === "GET") {
    return request;
  }

  const body = await readBodyText(request, maxAuthenticationBodyBytes);
  const headers = new Headers(request.headers);

  headers.delete("content-length");

  return new Request(request.url, {
    method: request.method,
    headers,
    body
  });
}

export async function handleAuthentication(request: Request) {
  try {
    const path = new URL(request.url).pathname.slice("/api/auth".length);

    if (endpoints.get(path) !== request.method) {
      throw new HttpError(404, "Authentication endpoint not found.");
    }

    if (request.method !== "GET") {
      requireOrigin(request);
    }

    const auth = await authentication();
    const response = await auth.handler(await withLimitedBody(request));

    if (response.status < 400) {
      const sanitized = await withoutTokens(response);

      sanitized.headers.set("Cache-Control", "no-store");

      return sanitized;
    }

    const data = await response.json().catch(() => null);
    const message = response.status >= 500 ? "Authentication could not be completed." : data?.message || "Authentication failed.";
    const problem = problemResponse(new HttpError(response.status, message), response.headers);
    const body = await problem.json();

    // Better Auth's maintained client reads message/code; retain them as Problem Details extensions.
    return Response.json({
      ...body,
      message: body.detail,
      code: response.status >= 500 ? "AUTHENTICATION_FAILED" : data?.code
    }, {
      status: response.status,
      headers: problem.headers
    });
  } catch (error) {
    return problemResponse(error);
  }
}
