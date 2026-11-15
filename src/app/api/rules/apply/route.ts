import { respond } from "@/server/http/respond";
import { applyRulesToUncorrectedTransactions } from "@/features/categorization/server/categorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, () => applyRulesToUncorrectedTransactions());
}
