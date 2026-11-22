import { respond } from "@/server/http/respond";
import { searchListings } from "@/features/securities/server/price-update-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, () => searchListings(new URL(request.url).searchParams), {
    access: "session"
  });
}
