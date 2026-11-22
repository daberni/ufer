import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { duplicateCandidates, markDuplicate } from "@/features/transactions/server/duplicate-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return duplicateCandidates(id);
  });
}

export async function PUT(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return markDuplicate(id, await readJson(request));
  });
}
