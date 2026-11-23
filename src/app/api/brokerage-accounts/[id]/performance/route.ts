import { respond } from "@/server/http/respond";
import { readBrokeragePerformance } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => readBrokeragePerformance((await context.params).id), {
    access: "session"
  });
}
