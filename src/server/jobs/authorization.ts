import { constantTimeEqual } from "@/server/security/tokens";

export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;

  return Boolean(secret && secret.length >= 32 && constantTimeEqual(request.headers.get("authorization") || "", `Bearer ${secret}`));
}
