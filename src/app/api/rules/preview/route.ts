import { respond } from "@/server/http/respond";
import { previewRule } from "@/features/categorization/server/categorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => previewRule(Object.fromEntries(new URL(request.url).searchParams)));
}
