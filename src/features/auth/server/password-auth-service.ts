import { HttpError } from "@/lib/errors";
import { constantTimeEqual, hash } from "@/server/security/tokens";
import { clearLoginAttempts, recordLoginAttempt } from "./login-attempt-repository";

export async function checkPassword(password: string) {
  const configured = process.env.APP_PASSWORD;

  if (!configured) {
    throw new HttpError(503, "APP_PASSWORD is not configured.");
  }

  // This shared installation limit cannot be bypassed by spoofing a proxy's client-IP header.
  const fingerprint = hash("budget-monitor-login");
  const now = Date.now();
  const attempts = await recordLoginAttempt(fingerprint, now);

  if (attempts > 10) {
    throw new HttpError(429, "Too many sign-in attempts. Try again later.");
  }

  // APP_PASSWORD is an operator-managed environment secret, not a stored user-password hash.
  if (!constantTimeEqual(password, configured)) {
    throw new HttpError(401, "Incorrect password.");
  }

  await clearLoginAttempts(fingerprint, now);
}
