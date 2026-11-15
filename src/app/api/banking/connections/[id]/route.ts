import { respond } from "@/server/http/respond";
import { removeBankConnection } from "@/features/banking/server/connection-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return removeBankConnection(id);
  });
}
