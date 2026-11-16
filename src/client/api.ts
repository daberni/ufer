import type { ProblemDetails } from "@/lib/problem-details";

export function apiError(problem: Partial<ProblemDetails>, status: number) {
  return Object.assign(new Error(problem.detail || problem.title || "Request failed."), {
    status,
    traceId: problem.traceId,
    instance: problem.instance
  });
}

/** The HTTP status of a failed API request; undefined for network and client-side failures. */
export function errorStatus(error: unknown) {
  if (error instanceof Error && "status" in error && typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

/** A failed request as shown to the user: the message, plus the server's trace ID for failures support can look up. */
export type Failure = {
  message: string;
  traceId?: string;
};

// User-facing text for a failed request; API failures carry the Problem Details detail or title.
export function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

/** The trace ID of a server failure (status 500 and above); validation and other client failures have none to show. */
export function failureTraceId(error: unknown) {
  const status = errorStatus(error);

  if (error instanceof Error && "traceId" in error && typeof error.traceId === "string" && status !== undefined && status >= 500) {
    return error.traceId;
  }

  return undefined;
}

export function toFailure(error: unknown): Failure {
  return {
    message: failureMessage(error),
    traceId: failureTraceId(error)
  };
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    cache: "no-store"
  });
  const data = await readJson(response);

  if (!response.ok) {
    const headerTraceId = response.headers.get("x-trace-id") ?? undefined;
    // A JSON body without a detail or title is not Problem Details, for example an intermediary's own error object.
    const problem = isRecord(data) && (typeof data.detail === "string" || typeof data.title === "string") ? data : {
      detail: `The server could not complete the request (HTTP ${response.status}).`
    };

    throw apiError({
      ...problem,
      traceId: typeof problem.traceId === "string" ? problem.traceId : headerTraceId
    }, response.status);
  }

  if (data === undefined) {
    throw apiError({
      detail: `The server returned an unreadable response (HTTP ${response.status}).`
    }, response.status);
  }

  return data as T;
}

// Intermediaries answer with HTML or plain text, so a body that is not JSON is data to ignore, not an exception.
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Partial<ProblemDetails> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a resource; the signal lets the query cache cancel requests whose results are no longer needed. */
export function apiGet<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const query = params ? new URLSearchParams(params).toString() : "";

  return send<T>(query ? `${path}?${query}` : path, {
    signal
  });
}

/** Sends a write with a JSON body; a write without a body, such as DELETE, leaves it out. */
export function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return send<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    })
  });
}
