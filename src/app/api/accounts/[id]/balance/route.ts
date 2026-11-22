import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { updateManualValuation } from "@/features/accounts/server/account-service";
import { readBalanceHistory } from "@/features/accounts/server/account-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return readBalanceHistory(id);
  });
}

export async function POST(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return updateManualValuation(id, await readJson(request));
  });
}
