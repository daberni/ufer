import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { importMappedRows } from "@/features/imports/server/mapped-import-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => importMappedRows(await readJson(request)), {
    status: 200
  });
}
