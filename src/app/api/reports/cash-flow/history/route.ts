import { respond } from "@/server/http/respond";
import { dashboardFilters } from "@/server/http/dashboard-filters";
import { readCashFlowHistory } from "@/features/reports/server/cash-flow-query";
import { parsePeriod } from "@/lib/period";
import { HttpError } from "@/lib/errors";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => {
    const query = new URL(request.url).searchParams;
    const filters = dashboardFilters(query);
    const before = parsePeriod(query.get("before") ?? "");

    if (before?.kind !== "month") {
      throw new HttpError(400, "Invalid month.");
    }

    return readCashFlowHistory(filters.currency, before.month);
  });
}
