import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { createImportAccount } from "@/features/imports/server/mapped-import-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return respond(request, async () => createImportAccount(await readJson(request)), {
    status: 201
  });
}
