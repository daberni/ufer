import { respond } from "@/server/http/respond";
import { readCombinedBrokeragePerformance } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, async () => readCombinedBrokeragePerformance(), {
    access: "session"
  });
}
