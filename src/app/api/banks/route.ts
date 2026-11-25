import { z } from "zod";
import { listBanks } from "@/features/banking/server/enable-banking-client";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(request: Request) {
  return respond(request, async () => {
    const country = z.string().regex(/^[A-Z]{2}$/).parse(new URL(request.url).searchParams.get("country"));

    return {
      banks: await listBanks(country)
    };
  });
}
