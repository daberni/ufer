import { respond } from "@/server/http/respond";
import { categoryUsage } from "@/features/categorization/server/categorization-service";

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

    return categoryUsage(id);
  });
}
