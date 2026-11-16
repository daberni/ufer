import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Marks the given query prefixes stale and refetches those currently shown; resolves when the refetches finish, whether or not they succeed. */
export async function invalidate(queryClient: QueryClient, keys: QueryKey[]) {
  await Promise.all(keys.map(queryKey => queryClient.invalidateQueries({
    queryKey
  })));
}
