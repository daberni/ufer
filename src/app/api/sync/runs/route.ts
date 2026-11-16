import { respond } from "@/server/http/respond";
import { listRecentSyncRuns } from "@/features/banking/server/banking-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => listRecentSyncRuns());
}
