import { bankConnectionsHref } from "@/features/banking/connections-location";
import { requireAuth } from "@/features/auth/server/session";
import { applicationOrigin } from "@/server/http/origin";
import { callbackResultForError, type CallbackResult } from "@/features/banking/callback-result";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cancelAuthorization, completeAuthorization } from "@/features/banking/server/authorization-service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const base = applicationOrigin();
  const cancelled = Boolean(query.get("error"));
  let result: CallbackResult = cancelled ? "cancelled" : "connected";

  try {
    const state = query.get("state");
    const code = query.get("code");
    const browser = (await cookies()).get("budget_bank_flow")?.value;

    if (cancelled) {
      if (state && browser) {
        await cancelAuthorization(state, browser, await requireAuth(request));
      }
    } else if (!state || !code || !browser) {
      result = "incomplete";
    } else {
      const actor = await requireAuth(request);

      await completeAuthorization(state, browser, code, actor);
    }
  } catch (error) {
    // A cancellation is reported as such even if its state could not be consumed; that state then expires unused.
    if (!cancelled) {
      result = callbackResultForError(error);
    }
  }

  const destination = new URL(bankConnectionsHref, base);

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
