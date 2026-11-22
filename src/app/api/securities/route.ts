import { respond } from "@/server/http/respond";
import { readJson } from "@/server/http/request-body";
import { createSecurity, readSecurities } from "@/features/securities/server/security-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(request, () => readSecurities(), {
    access: "session"
  });
}

export async function POST(request: Request) {
  return respond(request, async () => createSecurity(await readJson(request)), {
    access: "session",
    status: 201
  });
}
