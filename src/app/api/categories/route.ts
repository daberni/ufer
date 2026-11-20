import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { createCategory } from "@/features/categorization/server/categorization-service";
import { listCategories } from "@/features/categorization/server/categorization-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => listCategories());
}

export async function POST(request: Request) {
  return respond(request, async () => createCategory(await readJson(request)), {
    status: 201
  });
}
