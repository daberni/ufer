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

// User-facing text for a failed request; API failures carry the Problem Details detail or title.
// Server failures ask the user to quote the trace ID, so it is part of the text.
export function failureMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Request failed.";
  }

  const status = errorStatus(error);
  const traceId = "traceId" in error && typeof error.traceId === "string" ? error.traceId : undefined;

  if (traceId && status !== undefined && status >= 500) {
    return `${error.message} Trace ID: ${traceId}`;
  }

  return error.message;
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    cache: "no-store"
  });
  const data = await readJson(response);

  if (!response.ok) {
    throw apiError(isRecord(data) ? data : {
      detail: `The server could not complete the request (HTTP ${response.status}).`,
      traceId: response.headers.get("x-trace-id") ?? undefined
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
