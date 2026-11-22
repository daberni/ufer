import { respond } from "@/server/http/respond";
import { settlementCandidates } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => settlementCandidates((await context.params).id, new URL(request.url).searchParams), {
    access: "session"
  });
}
