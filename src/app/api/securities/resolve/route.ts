import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { resolveSecurity } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return respond(request, async () => resolveSecurity(await readJson(request)), {
    access: "session"
  });
}
