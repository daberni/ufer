import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/server/http/dashboard-filters";
import { readCashFlow } from "@/features/reports/server/cash-flow-query";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => {
    const filters = dashboardFilters(new URL(request.url).searchParams);

    return readCashFlow(filters.period, filters.currency);
  });
}
