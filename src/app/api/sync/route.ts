import { syncAccounts } from "@/features/banking/server/sync-service";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, () => syncAccounts(), {
    access: "session"
  });
}
