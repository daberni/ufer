import { respond } from "@/server/http/respond";
import { updateTransactionCategory } from "@/features/transactions/server/transaction-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return updateTransactionCategory(id, await request.json());
  });
}
