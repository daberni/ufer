import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPassword } from "@/features/auth/server/password-auth-service";
import { installationSession } from "@/features/auth/server/session";
import { respond } from "@/server/http/respond";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => {
    const { password } = z.object({
      password: z.string().max(200)
    }).parse(await request.json());

    await checkPassword(password);
    const session = await installationSession();

    session.authenticated = true;
    await session.save();

    return NextResponse.json({
      ok: true
    });
  }, {
    access: "public"
  });
}
