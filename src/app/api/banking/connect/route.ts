import { requireAuth } from "@/features/auth/server/session";
import { NextResponse } from "next/server";
import { respond } from "@/server/http/respond";
import { connectBank } from "@/features/banking/server/connect-bank";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(request, async () => {
    const result = await connectBank(await request.json(), await requireAuth(request));
    const response = NextResponse.json({
      url: result.url
    });

    response.cookies.set("budget_bank_flow", result.browser, {
      httpOnly: true,
      sameSite: "lax",
      secure: result.secure,
      path: "/api/banking/callback",
      maxAge: 900
    });

    return response;
  });
}
