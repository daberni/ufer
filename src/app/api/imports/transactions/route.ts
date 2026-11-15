import { respond } from "@/server/http/respond";
import { importTransactions } from "@/features/imports/server/import-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => importTransactions(await request.json()), {
    status: 200
  });
}
