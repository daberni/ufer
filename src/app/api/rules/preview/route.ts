import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { previewRule } from "@/features/categorization/server/categorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

// A read that posts its draft rule, so payee and remittance text stay out of URLs; it stores nothing.
export async function POST(request: Request) {
  return respond(request, async () => previewRule(await readJson(request)));
}
