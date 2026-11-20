import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { changeTemplate, removeTemplate } from "@/features/imports/server/template-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return changeTemplate(id, await readJson(request));
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return removeTemplate(id);
  });
}
