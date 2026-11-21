import { headers } from "next/headers";
import { hasWorkspaceAccess } from "./session";

/**
 * Whether this request has dashboard access: `true` and `false` are confirmed, `undefined` means the session could not be checked. The dashboard then starts signed in without server data: its requests report the problem per area, and a rejected session still locks it.
 */
export async function requestWorkspaceAccess() {
  const requestHeaders = await headers();

  try {
    return await hasWorkspaceAccess(requestHeaders);
  } catch (error) {
    console.error("The dashboard session could not be checked.", error);

    return undefined;
  }
}
