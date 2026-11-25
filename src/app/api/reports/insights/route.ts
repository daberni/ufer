import { respond } from "@/server/http/respond";
import { insightsFilters } from "@/features/insights/server/insights-filters";
import { readInsights } from "@/features/insights/server/insights-query";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => {
    const filters = insightsFilters(new URL(request.url).searchParams);

    return readInsights(filters.range, filters.currency);
  });
}
