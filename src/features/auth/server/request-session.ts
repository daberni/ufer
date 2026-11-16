import { headers } from "next/headers";
import { hasWorkspaceAccess } from "./session";

/**
 * Whether the server confirmed that this request has no dashboard access, so the dashboard starts with the sign-in screen. When the session cannot be checked, the dashboard starts signed in: its requests then report the problem per area, and a rejected session still locks it.
 */
export async function requestSignedOut() {
  const requestHeaders = await headers();

  try {
    return !(await hasWorkspaceAccess(requestHeaders));
  } catch (error) {
    console.error("The dashboard session could not be checked.", error);

    return false;
  }
}
