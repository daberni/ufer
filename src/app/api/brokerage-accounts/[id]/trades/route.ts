import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { readBrokerageTrades, recordTrade } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => readBrokerageTrades((await context.params).id), {
    access: "session"
  });
}

export async function POST(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return recordTrade(id, await readJson(request));
  }, {
    access: "session",
    status: 201
  });
}
