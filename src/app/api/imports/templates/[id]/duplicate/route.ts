import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { duplicateTemplate } from "@/features/imports/server/template-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return duplicateTemplate(id, await readJson(request));
  }, {
    status: 201
  });
}
