import { respond } from "@/server/http/respond";
import { archiveAccount, requestsClosing, restoreAccount } from "@/features/accounts/server/account-service";
import { closeManualAccount } from "@/features/transactions/server/manual-account-service";
import { readJson } from "@/server/http/request-body";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function PUT(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;
    const payload = await readJson(request);

    return requestsClosing(payload) ? closeManualAccount(id, payload) : archiveAccount(id, payload);
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return restoreAccount(id);
  });
}
