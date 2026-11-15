import { requireAuth } from "@/features/auth/server/session";
import { HttpError } from "@/lib/errors";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { completeAuthorization } from "@/features/banking/server/authorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const base = process.env.APP_URL || "http://localhost:3000";
  let result = "connected";

  try {
    if (query.get("error")) {
      throw new HttpError(400, "The bank connection was cancelled. Start again.");
    }

    const browser = (await cookies()).get("budget_bank_flow")?.value;

    if (!query.get("state") || !query.get("code") || !browser) {
      throw new HttpError(400, "The bank callback is incomplete. Reconnect using the same browser.");
    }

    const actor = await requireAuth(request);

    await completeAuthorization(query.get("state")!, browser, query.get("code")!, actor);
  } catch (error) {
    result = error instanceof HttpError ? error.message : "Bank connection failed.";
  }

  const destination = new URL("/", base);

  destination.searchParams.set("banking", result);
  const response = NextResponse.redirect(destination, 303);

  response.cookies.set("budget_bank_flow", "", {
    path: "/api/banking/callback",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax"
  });

  return response;
}
