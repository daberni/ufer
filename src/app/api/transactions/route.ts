import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/server/http/dashboard-filters";
import { readTransactionPage } from "@/features/transactions/server/transaction-list-query";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => readTransactionPage(dashboardFilters(new URL(request.url).searchParams)));
}
