import { HttpError } from "@/lib/errors";
import { STATUS_CODES } from "node:http";
import { NextResponse } from "next/server";
import { cronAuthorized } from "@/server/jobs/authorization";
import { requireAuth } from "@/features/auth/server/session";
import { requireOrigin } from "./origin";
import { problemResponse } from "./problem-response";

type RouteOptions = {
  access?: "session" | "public" | "scheduler";
  status?: number;
};

export async function respond(request: Request, action: () => Promise<unknown>, options: RouteOptions = {}) {
  try {
    if (request.method !== "GET") {
      requireOrigin(request);
    }

    const access = options.access ?? "session";

    if (access === "session") {
      await requireAuth();
    }

    if (access === "scheduler" && !cronAuthorized(request)) {
      throw new HttpError(401, "Cron access denied.");
    }

    const result = await action();

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
