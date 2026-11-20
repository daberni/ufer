import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { readPayeeSuggestions } from "@/features/transactions/server/payee-suggestions";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

// A read sent as POST so the typed payee stays out of request URLs and access logs.
export async function POST(request: Request) {
  return respond(request, async () => readPayeeSuggestions(await readJson(request)));
}
