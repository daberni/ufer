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

/** The session the request carries and its membership in this workspace; null without a valid session. */
async function sessionMembership(headers: Headers) {
  const auth = await authentication();
  const identity = await auth.api.getSession({
    headers
  });

  if (!identity) {
    return null;
  }

  return {
    identity,
    membership: await activeMembership(identity.user.id)
  };
}

export async function requireAuth(request: Request): Promise<AuthContext> {
  const session = await sessionMembership(request.headers);

  if (!session) {
    throw new HttpError(401, "Sign in to continue.");
  }

  const {
    identity,
    membership
  } = session;

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

/** Whether the request carries a session with access to this workspace, which the API would accept. */
export async function hasWorkspaceAccess(headers: Headers) {
  const session = await sessionMembership(headers);

  return Boolean(session?.membership);
}
