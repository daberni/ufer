import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { createTemplate, readTemplates } from "@/features/imports/server/template-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, () => readTemplates());
}

export async function POST(request: Request) {
  return respond(request, async () => createTemplate(await readJson(request)), {
    status: 201
  });
}
