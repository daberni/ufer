import { HttpError } from "@/lib/errors";
import { problemResponse } from "@/server/http/problem-response";
import { requireOrigin } from "@/server/http/origin";
import { authentication } from "@/server/security/auth";

const endpoints = new Map([
  ["/sign-in/username", "POST"],
  ["/sign-out", "POST"],
  ["/get-session", "GET"],
  ["/change-password", "POST"],
  ["/list-sessions", "GET"],
  ["/revoke-other-sessions", "POST"]
]);

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
    const response = await auth.handler(request);

    if (response.status < 400) {
      response.headers.set("Cache-Control", "no-store");

      return response;
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
