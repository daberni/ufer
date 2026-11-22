import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { correctTrade, removeTrade } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => removeTrade((await context.params).id), {
    access: "session"
  });
}

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return correctTrade(id, await readJson(request));
  }, {
    access: "session"
  });
}
