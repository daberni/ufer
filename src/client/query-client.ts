import { QueryClient } from "@tanstack/react-query";
import { errorStatus } from "./api";

const transientStatuses = new Set([502, 503, 504]);

/** Retries a read once after a network failure or a temporarily unavailable server; client errors and other server errors are final. */
export function retryRead(failureCount: number, error: unknown) {
  const status = errorStatus(error);
  const transient = status === undefined || transientStatuses.has(status);

  return transient && failureCount < 1;
}

/**
 * Server state for the dashboard. Writes invalidate the queries they affect. Data older than the stale time is refetched when a view mounts or the window regains focus, which also picks up scheduled syncs; quick tab switches reuse fresh data.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: retryRead
      },
      mutations: {
        retry: false
      }
    }
  });
}
