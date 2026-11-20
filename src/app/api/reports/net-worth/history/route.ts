import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/server/http/dashboard-filters";
import { readNetWorthHistory } from "@/features/reports/server/net-worth-history-query";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => readNetWorthHistory(dashboardFilters(new URL(request.url).searchParams).currency));
}
