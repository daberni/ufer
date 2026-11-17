import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/server/http/dashboard-filters";
import { readAccountCashFlow } from "@/features/reports/server/cash-flow-query";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;
    const filters = dashboardFilters(new URL(request.url).searchParams);

    return readAccountCashFlow(id, filters.period);
  });
}
