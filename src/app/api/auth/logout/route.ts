import { NextResponse } from "next/server";
import { respond } from "@/server/http/respond";
import { installationSession } from "@/features/auth/server/session";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => {
    const session = await installationSession();

    session.destroy();

    return NextResponse.json({
      ok: true
    });
  });
}
