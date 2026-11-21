import { QueryClient, dehydrate } from "@tanstack/react-query";
import { queryKeys } from "@/client/query-keys";
import { listAccounts } from "@/features/accounts/server/account-queries";
import { listCategories } from "@/features/categorization/server/categorization-queries";

/**
 * Small cross-view queries resolved with the first response, so account- and category-dependent controls render final instead of shifting once they load. The keys and projections match the dashboard's route handlers; a failed read is left out and loads in the browser as usual. Larger per-page data keeps its own per-area loading.
 */
export async function initialServerState() {
  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: queryKeys.accounts(),
      queryFn: listAccounts
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.categories(),
      queryFn: listCategories
    })
  ]);

  return dehydrate(queryClient);
}
