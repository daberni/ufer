import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { reorderRules } from "@/features/categorization/server/categorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function PUT(request: Request) {
  return respond(request, async () => reorderRules(await readJson(request)));
}
