import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/features/dashboard/server/dashboard-filters";
import { readDashboardState } from "@/features/dashboard/server/dashboard-query";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => readDashboardState(dashboardFilters(new URL(request.url).searchParams)));
}
