import { requireAuth } from "@/features/auth/server/session";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, async () => {
    const actor = await requireAuth(request);

    return {
      name: actor.name,
      username: actor.username,
      email: actor.email,
      role: actor.role
    };
  });
}
