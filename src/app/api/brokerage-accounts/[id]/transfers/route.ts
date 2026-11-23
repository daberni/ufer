import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { recordTransfer } from "@/features/securities/server/transfer-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function POST(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return recordTransfer(id, await readJson(request));
  }, {
    access: "session",
    status: 201
  });
}
