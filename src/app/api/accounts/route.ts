import { respond } from "@/server/http/respond";
import { createManualAccount } from "@/features/accounts/server/account-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => createManualAccount(await request.json()), {
    status: 201
  });
}
