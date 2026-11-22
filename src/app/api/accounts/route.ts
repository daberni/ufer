import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { createManualAccount } from "@/features/transactions/server/manual-account-service";
import { listAccounts } from "@/features/accounts/server/account-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => listAccounts());
}

export async function POST(request: Request) {
  return respond(request, async () => createManualAccount(await readJson(request)), {
    status: 201
  });
}
