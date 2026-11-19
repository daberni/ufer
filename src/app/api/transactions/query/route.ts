import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { readTransactionPage } from "@/features/transactions/server/transaction-list-query";
import { transactionListRequest } from "@/features/transactions/server/transaction-list-request";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

// A read sent as POST so the search text and other filters stay out of request URLs and access logs.
export async function POST(request: Request) {
  return respond(request, async () => readTransactionPage(transactionListRequest(await readJson(request))));
}
