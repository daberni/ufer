import { HttpError } from "@/lib/errors";
import { authentication } from "./auth";
import { activeMembership } from "./membership-repository";

export type AuthContext = {
  userId: string;
  sessionId: string;
  workspaceId: string;
  role: "owner" | "member";
  name: string;
  username: string;
  email: string;
};

export async function requireAuth(request: Request): Promise<AuthContext> {
  const auth = await authentication();
  const identity = await auth.api.getSession({
    headers: request.headers
  });

  if (!identity) {
    throw new HttpError(401, "Sign in to continue.");
  }

  const membership = await activeMembership(identity.user.id);

  if (!membership) {
    throw new HttpError(403, "Your user does not have access to this workspace. Contact the operator.");
  }

  return {
    userId: identity.user.id,
    sessionId: identity.session.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
    name: identity.user.name,
    username: identity.user.username || "",
    email: identity.user.email
  };
}
