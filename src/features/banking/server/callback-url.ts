import { applicationOrigin } from "@/server/http/origin";

export function bankCallbackUrl() {
  return process.env.ENABLE_BANKING_REDIRECT_URL || `${applicationOrigin()}/api/banking/callback`;
}
