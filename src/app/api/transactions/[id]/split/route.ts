import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { splitTransaction, unsplitTransaction } from "@/features/transactions/server/split-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function PUT(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return splitTransaction(id, await readJson(request));
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return unsplitTransaction(id);
  });
}
