import { respond } from "@/server/http/respond";
import { createManualAccount } from "@/features/accounts/server/account-service";
import { listAccounts } from "@/features/accounts/server/account-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => listAccounts());
}

export async function POST(request: Request) {
  return respond(request, async () => createManualAccount(await request.json()), {
    status: 201
  });
}
