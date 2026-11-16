import { requireAuth } from "@/features/auth/server/session";
import { applicationOrigin } from "@/server/http/origin";
import { callbackResultForError, type CallbackResult } from "@/features/banking/callback-result";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { completeAuthorization } from "@/features/banking/server/authorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const base = applicationOrigin();
  let result: CallbackResult = "connected";

  try {
    const state = query.get("state");
    const code = query.get("code");
    const browser = (await cookies()).get("budget_bank_flow")?.value;

    if (query.get("error")) {
      result = "cancelled";
    } else if (!state || !code || !browser) {
      result = "incomplete";
    } else {
      const actor = await requireAuth(request);

      await completeAuthorization(state, browser, code, actor);
    }
  } catch (error) {
    result = callbackResultForError(error);
  }

  const destination = new URL("/connections", base);

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
