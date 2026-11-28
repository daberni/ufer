import { respond } from "@/server/http/respond";
import { readBrokerageHolding } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string;
    securityId: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  return respond(request, async () => {
    const {
      id,
      securityId
    } = await context.params;

    return readBrokerageHolding(id, securityId);
  }, {
    access: "session"
  });
}
