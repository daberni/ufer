import { bankCountries } from "@/features/banking/server/enable-banking-client";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, async () => ({
    countries: await bankCountries()
  }), {
    access: "session"
  });
}
