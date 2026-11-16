"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "./query-client";

let browserQueryClient: QueryClient | undefined;

// Server renders get their own client; the browser keeps one cache across renders and route changes.
function queryClient() {
  if (typeof window === "undefined") {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();

  return browserQueryClient;
}

export function QueryProvider({ children }: {
  children: React.ReactNode
}) {
  return <QueryClientProvider client={queryClient()}>{children}</QueryClientProvider>;
}
