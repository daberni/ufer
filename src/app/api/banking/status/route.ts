import { respond } from "@/server/http/respond";
import { bankingStatus } from "@/features/banking/server/banking-queries";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, async () => bankingStatus());
}
