import { respond } from "@/server/http/respond";
import { createRule } from "@/features/categorization/server/categorization-service";
import { listRuleSummaries } from "@/features/categorization/server/categorization-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => listRuleSummaries());
}

export async function POST(request: Request) {
  return respond(request, async () => createRule(await request.json()), {
    status: 201
  });
}
