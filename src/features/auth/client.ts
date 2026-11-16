"use client";

import { createAuthClient } from "better-auth/react";
import { apiError } from "@/client/api";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [usernameClient()]
});

// Keeps the HTTP status and trace ID, so an ended session (401) locks the dashboard and server failures show their trace ID like any other API failure.
export function requireAuthResult(result: {
  error: {
    message?: string;
    status?: number;
    traceId?: string;
  } | null
}) {
  if (result.error) {
    throw apiError({
      detail: result.error.message || "Authentication failed.",
      traceId: result.error.traceId
    }, result.error.status as number);
  }
}
