import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { enterManualTransaction } from "@/features/transactions/server/transaction-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return enterManualTransaction(id, await readJson(request));
  }, {
    status: 201
  });
}
