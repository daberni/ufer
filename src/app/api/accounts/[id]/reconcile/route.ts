import { respond } from "@/server/http/respond";
import { reconcileBankBalance } from "@/features/accounts/server/account-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return reconcileBankBalance(id);
  }, {
    access: "session"
  });
}
