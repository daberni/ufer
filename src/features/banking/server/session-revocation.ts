import { decrypt } from "@/server/security/secret-box";
import { BankingError, deleteSession, sessionEnded } from "./enable-banking-client";

/** A failed attempt keeps the credential and leaves retrying to the user; ended sessions count as confirmed revocations. */
export async function revokeSession(sessionCipher: string): Promise<boolean> {
  try {
    await deleteSession(decrypt(sessionCipher));
  } catch (error) {
    if (!sessionEnded(error)) {
      console.warn("Enable Banking session revocation failed; retry removal in Bank connections.", {
        reason: revocationFailureReason(error)
      });

      return false;
    }
  }

  return true;
}

// Provider error codes and exception types are safe to log; messages may contain provider or configuration details.
function revocationFailureReason(error: unknown) {
  if (error instanceof BankingError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "unknown";
}
