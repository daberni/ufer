import { HttpError } from "@/lib/errors";

// The callback URL is user-controllable, so the client only renders the catalog's fixed messages (banking.callback) for known codes.
const failureResults = ["cancelled", "incomplete", "expired", "removed", "failed"] as const;

type CallbackFailure = typeof failureResults[number];

export type CallbackResult = "connected" | CallbackFailure;

export function parseCallbackResult(value: string | null): CallbackResult | null {
  if (value === "connected") {
    return value;
  }

  return failureResults.find(result => result === value) ?? null;
}

// Provider and validation messages stay in the connection's stored error; only the outcome class reaches the URL.
export function callbackResultForError(error: unknown): CallbackFailure {
  if (error instanceof HttpError && error.status === 400) {
    return "expired";
  }

  if (error instanceof HttpError && error.status === 409) {
    return "removed";
  }

  return "failed";
}
