import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { correctTransfer, removeTransfer } from "@/features/securities/server/transfer-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => removeTransfer((await context.params).id), {
    access: "session"
  });
}

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return correctTransfer(id, await readJson(request));
  }, {
    access: "session"
  });
}
