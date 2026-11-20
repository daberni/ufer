import { respond } from "@/server/http/respond";
import { hideTransaction } from "@/features/transactions/server/transaction-service";

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

    return hideTransaction(id, true);
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return hideTransaction(id, false);
  });
}
