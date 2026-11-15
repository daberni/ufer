"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [usernameClient()]
});

export function requireAuthResult(result: {
  error: {
    message?: string;
    status?: number
  } | null
}) {
  if (result.error) {
    throw new Error(result.error.message || "Authentication failed.");
  }
}
