import { respond } from "@/server/http/respond";
import { setAccountArchived } from "@/features/accounts/server/account-service";

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

    return setAccountArchived(id, true);
  });
}

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return setAccountArchived(id, false);
  });
}
