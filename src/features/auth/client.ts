"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [usernameClient()]
});

// Keeps the HTTP status, so an ended session (401) locks the dashboard like any other API failure.
export function requireAuthResult(result: {
  error: {
    message?: string;
    status?: number
  } | null
}) {
  if (result.error) {
    throw Object.assign(new Error(result.error.message || "Authentication failed."), {
      status: result.error.status
    });
  }
}
