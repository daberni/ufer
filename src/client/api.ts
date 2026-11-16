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
export function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    cache: "no-store"
  });
  const data = await response.json();

  if (!response.ok) {
    throw apiError(data, response.status);
  }

  return data as T;
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
