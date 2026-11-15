import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/features/dashboard/server/dashboard-filters";
import { readNetWorth } from "@/features/accounts/server/account-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => readNetWorth(dashboardFilters(new URL(request.url).searchParams).currency));
}
