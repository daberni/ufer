import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/server/http/content-security-policy";

// Next.js reads the nonce from the request's policy while rendering and attaches it to its own scripts.
export function proxy(request: NextRequest) {
  const policy = contentSecurityPolicy(createNonce(), process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

  response.headers.set("Content-Security-Policy", policy);

  return response;
}

export const config = {
  matcher: [{
    source: "/((?!api/|_next/static/|_next/image|icon.svg|apple-icon.png).*)",
    missing: [{
      type: "header",
      key: "next-router-prefetch"
    }, {
      type: "header",
      key: "purpose",
      value: "prefetch"
    }]
  }]
};
