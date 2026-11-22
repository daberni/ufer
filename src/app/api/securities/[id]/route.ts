import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { updateSecurityListing } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    id: string
  }>;
};

export async function PATCH(request: Request, context: Context) {
  return respond(request, async () => {
    const { id } = await context.params;

    return updateSecurityListing(id, await readJson(request));
  }, {
    access: "session"
  });
}
