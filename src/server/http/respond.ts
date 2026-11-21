import { HttpError } from "@/lib/errors";
import { STATUS_CODES } from "node:http";
import { NextResponse } from "next/server";
import { cronAuthorized } from "@/server/jobs/authorization";
// eslint-disable-next-line boundaries/dependencies -- known violation tracked in daberni/ufer#285
import { requireAuth, type AuthContext } from "@/features/auth/server/session";
import { requireOrigin } from "./origin";
import { problemResponse } from "./problem-response";
import { measurePhase, measureRequest } from "./server-timing";

type ResponseOptions = {
  status?: number;
};

type SessionRouteOptions = ResponseOptions & {
  access?: "session";
};

type AnonymousRouteOptions = ResponseOptions & {
  access: "public" | "scheduler";
};

type RouteOptions = SessionRouteOptions | AnonymousRouteOptions;

type SessionAction = (actor: AuthContext) => Promise<unknown>;

type AnonymousAction = () => Promise<unknown>;

/** Runs a route action and returns its result or Problem Details; signed-in routes receive the verified session and membership. */
export function respond(request: Request, action: SessionAction, options?: SessionRouteOptions): Promise<Response>;

export function respond(request: Request, action: AnonymousAction, options: AnonymousRouteOptions): Promise<Response>;

export function respond(request: Request, action: SessionAction, options: RouteOptions = {}): Promise<Response> {
  return measureRequest(() => handle(request, action, options));
}

async function handle(request: Request, action: SessionAction, options: RouteOptions) {
  try {
    if (request.method !== "GET") {
      requireOrigin(request);
    }

    const access = options.access ?? "session";
    let actor: AuthContext | undefined;

    if (access === "session") {
      actor = await measurePhase("auth", () => requireAuth(request));
    }

    if (access === "scheduler" && !cronAuthorized(request)) {
      throw new HttpError(401, "Cron access denied.");
    }

    // The overloads accept only parameterless actions for routes without a session.
    const result = await measurePhase("action", () => actor ? action(actor) : (action as AnonymousAction)());

    const response = result instanceof Response ? result : NextResponse.json(result, {
      status: options.status ?? 200
    });

    if (response.status >= 400) {
      const error = new HttpError(response.status, STATUS_CODES[response.status] ?? "The request failed.");

      return problemResponse(error, response.headers);
    }

    return response;
  } catch (error) {
    return problemResponse(error);
  }
}
