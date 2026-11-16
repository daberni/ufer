import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { importValuations } from "@/features/imports/server/import-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => importValuations(await readJson(request)), {
    status: 200
  });
}
