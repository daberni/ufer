import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, async actor => {
    return {
      name: actor.name,
      username: actor.username,
      email: actor.email,
      role: actor.role
    };
  });
}
