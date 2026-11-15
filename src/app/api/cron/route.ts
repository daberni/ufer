import { syncAccounts } from "@/features/banking/server/sync-service";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, () => syncAccounts(), {
    access: "scheduler"
  });
}
