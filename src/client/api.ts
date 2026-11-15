import type { ProblemDetails } from "@/lib/problem-details";

export function apiError(problem: Partial<ProblemDetails>, status: number) {
  return Object.assign(new Error(problem.detail || problem.title || "Request failed."), {
    status,
    traceId: problem.traceId,
    instance: problem.instance
  });
}

// User-facing text for a failed request; API failures carry the Problem Details detail or title.
export function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

export async function api<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    headers: {
      "Content-Type": "application/json"
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify(body)
    }),
    cache: "no-store"
  });
  const data = await response.json();

  if (!response.ok) {
    throw apiError(data, response.status);
  }

  return data as T;
}
