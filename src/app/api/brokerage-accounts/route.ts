import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { createBrokerageAccount } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return respond(request, async () => createBrokerageAccount(await readJson(request)), {
    access: "session",
    status: 201
  });
}
