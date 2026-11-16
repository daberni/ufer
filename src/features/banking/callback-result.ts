import { HttpError } from "@/lib/errors";

// The callback URL is user-controllable, so the client only renders fixed messages for known codes.
const resultMessages = {
  cancelled: "The bank connection was cancelled. Start again.",
  incomplete: "The bank callback is incomplete. Reconnect using the same browser.",
  expired: "The bank callback has expired, has already been used, or belongs to another browser.",
  removed: "The bank connection was removed during authorization.",
  failed: "Bank connection failed. Check the connection for details."
} as const;

export type CallbackResult = "connected" | keyof typeof resultMessages;

export function parseCallbackResult(value: string | null): CallbackResult | null {
  if (value === "connected") {
    return value;
  }

  return value !== null && Object.hasOwn(resultMessages, value) ? (value as keyof typeof resultMessages) : null;
}

export function callbackFailureMessage(result: Exclude<CallbackResult, "connected">) {
  return resultMessages[result];
}

// Provider and validation messages stay in the connection's stored error; only the outcome class reaches the URL.
export function callbackResultForError(error: unknown): Exclude<CallbackResult, "connected"> {
  if (error instanceof HttpError && error.status === 400) {
    return "expired";
  }

  if (error instanceof HttpError && error.status === 409) {
    return "removed";
  }

  return "failed";
}
